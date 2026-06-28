import * as THREE from '../libs/three/three.module.js';
import { GLTFLoader } from '../libs/three/jsm/GLTFLoader.js';
import { DRACOLoader } from '../libs/three/jsm/DRACOLoader.js';
import { RGBELoader } from '../libs/three/jsm/RGBELoader.js';
import { ARButton } from '../libs/ARButton.js';
import { LoadingBar } from '../libs/LoadingBar.js';

class App {
	constructor() {
		const container = document.createElement('div');
		document.body.appendChild(container);

		// status bar at bottom (under the AR layer, but visible before AR starts)
		this.statusEl = document.createElement('div');
		this.statusEl.style.cssText =
			'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:9999;color:#fff;background:rgba(0,0,0,0.8);padding:8px 16px;font:14px sans-serif;border-radius:8px;text-align:center;pointer-events:none;';
		this.statusEl.textContent = '';
		document.body.appendChild(this.statusEl);

		this.loadingBar = new LoadingBar();
		this.loadingBar.visible = false;

		this.assetsPath = './assets/';

		this.camera = new THREE.PerspectiveCamera(
			70,
			window.innerWidth / window.innerHeight,
			0.01,
			20
		);
		this.camera.position.set(0, 1.6, 0);

		this.scene = new THREE.Scene();

		const ambient = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
		ambient.position.set(0.5, 1, 0.25);
		this.scene.add(ambient);

		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setPixelRatio(window.devicePixelRatio);
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.outputEncoding = THREE.sRGBEncoding;
		container.appendChild(this.renderer.domElement);
		this.setEnvironment();

		this.reticle = new THREE.Mesh(
			new THREE.RingBufferGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial()
		);

		this.reticle.matrixAutoUpdate = false;
		this.reticle.visible = false;
		this.scene.add(this.reticle);

		this.setupXR();

		window.addEventListener('resize', this.resize.bind(this));
	}

	_setStatus(msg) {
		console.log(msg);
		this.statusEl.textContent = msg;
		// auto-clear after 3 seconds
		clearTimeout(this._statusTimer);
		this._statusTimer = setTimeout(() => {
			this.statusEl.textContent = '';
		}, 3000);
	}

	setupXR() {
		this.renderer.xr.enabled = true;

		const self = this;
		this.hitTestSourceRequested = false;
		this.hitTestSource = null;

		this._setStatus('Page ready');
	}

	resize() {
		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(window.innerWidth, window.innerHeight);
	}

	setEnvironment() {
		const loader = new RGBELoader().setDataType(THREE.UnsignedByteType);
		const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
		pmremGenerator.compileEquirectangularShader();

		const self = this;

		loader.load(
			'./assets/venice_sunset_1k.hdr',
			(texture) => {
				const envMap = pmremGenerator.fromEquirectangular(texture).texture;
				pmremGenerator.dispose();
				self.scene.environment = envMap;
			},
			undefined,
			(err) => {
				console.error('An error occurred setting the environment');
			}
		);
	}

	showModel() {
		this._setStatus('Starting AR...');
		this.initAR();

		const loader = new GLTFLoader().setPath(this.assetsPath);
		const self = this;
		let dracoLoader = new DRACOLoader();
		dracoLoader.setDecoderPath('../libs/three/js/draco/');
		loader.setDRACOLoader(dracoLoader);
		this.loadingBar.visible = true;

		loader.load(
			`desk_model.glb`,
			function (gltf) {
				self.scene.add(gltf.scene);
				self.mymesh = gltf.scene;
				self.mymesh.scale.set(0.7, 0.7, 0.7);
				self.mymesh.position.set(0, 0, 0);
				self.mymesh.visible = true;
				self.loadingBar.visible = false;
				self.renderer.setAnimationLoop(self.render.bind(self));
				self._setStatus('Model loaded — tap screen to place');
			},
			function (xhr) {
				self.loadingBar.progress = xhr.loaded / xhr.total;
			},
			function (error) {
				self._setStatus('ERROR: ' + error);
			}
		);
	}

	initAR() {
		const self = this;
		const sessionInit = { requiredFeatures: ['hit-test'] };

		function onSessionStarted(session) {
			self._setStatus('AR active — point at table');

			session.addEventListener('end', onSessionEnded);

			self.renderer.xr.setReferenceSpaceType('local');
			self.renderer.xr.setSession(session);

			// ---- raw WebXR session-level input events ----
			// These bypass Three.js and work even on iOS XRViewer
			session.addEventListener('selectstart', function (ev) {
				console.log('XR selectstart', ev);
				self._setStatus('Touch down');
				self._tryPlaceModel();
			});
			session.addEventListener('selectend', function (ev) {
				console.log('XR selectend', ev);
				self._setStatus('Touch up');
				self._tryPlaceModel();
			});
			session.addEventListener('select', function (ev) {
				console.log('XR select', ev);
				self._setStatus('Select');
				self._tryPlaceModel();
			});

			// also try Three.js controller events (post-session setup)
			const ctrl = self.renderer.xr.getController(0);
			ctrl.addEventListener('selectstart', function () {
				console.log('Three selectstart');
				self._tryPlaceModel();
			});
			ctrl.addEventListener('selectend', function () {
				console.log('Three selectend');
				self._tryPlaceModel();
			});
			ctrl.addEventListener('select', function () {
				console.log('Three select');
				self._tryPlaceModel();
			});
			self.scene.add(ctrl);

			self._xrSession = session;
		}

		function onSessionEnded() {
			self._setStatus('AR ended');
			if (self._xrSession) {
				self._xrSession = null;
			}
			if (self.mymesh !== null) {
				self.scene.remove(self.mymesh);
				self.mymesh = null;
			}
			self.renderer.setAnimationLoop(null);
		}

		navigator.xr.requestSession('immersive-ar', sessionInit).then(onSessionStarted);
	}

	_tryPlaceModel() {
		if (this.mymesh === undefined || this.mymesh === null) {
			this._setStatus('Model not ready');
			return;
		}

		if (this.reticle.visible) {
			this.mymesh.position.setFromMatrixPosition(this.reticle.matrix);
			this.mymesh.visible = true;
			this._setStatus('Placed on surface!');
		} else {
			// fallback: 1m in front of camera
			this.mymesh.position.set(0, 0, -1);
			this.mymesh.visible = true;
			this._setStatus('Placed (no surface detected)');
		}
	}

	requestHitTestSource() {
		const self = this;
		const session = this.renderer.xr.getSession();
		if (!session) return;

		session.requestReferenceSpace('viewer').then(function (referenceSpace) {
			session.requestHitTestSource({ space: referenceSpace }).then(function (source) {
				self.hitTestSource = source;
				console.log('Hit-test source ready');
			});
		});

		session.addEventListener('end', function () {
			self.hitTestSourceRequested = false;
			self.hitTestSource = null;
		});

		this.hitTestSourceRequested = true;
	}

	getHitTestResults(frame) {
		if (!this.hitTestSource) return;
		const hitTestResults = frame.getHitTestResults(this.hitTestSource);

		if (hitTestResults.length) {
			const referenceSpace = this.renderer.xr.getReferenceSpace();
			const hit = hitTestResults[0];
			const pose = hit.getPose(referenceSpace);
			this.reticle.visible = true;
			this.reticle.matrix.fromArray(pose.transform.matrix);
		} else {
			this.reticle.visible = false;
		}
	}

	render(timestamp, frame) {
		if (frame) {
			if (this.hitTestSourceRequested === false) this.requestHitTestSource();
			if (this.hitTestSource) this.getHitTestResults(frame);
		}
		this.renderer.render(this.scene, this.camera);
	}
}

export { App };
