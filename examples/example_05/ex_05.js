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

	setupXR() {
		this.renderer.xr.enabled = true;

		this.hitTestSourceRequested = false;
		this.hitTestSource = null;
		this._placed = false;  // whether model has been placed on a surface
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
				console.log('Model loaded');
			},
			function (xhr) {
				self.loadingBar.progress = xhr.loaded / xhr.total;
			},
			function (error) {
				console.log('Model load error:', error);
			}
		);
	}

	initAR() {
		const self = this;
		const sessionInit = { requiredFeatures: ['hit-test'] };

		function onSessionStarted(session) {
			session.addEventListener('end', onSessionEnded);

			self.renderer.xr.setReferenceSpaceType('local');
			self.renderer.xr.setSession(session);

			// listen for ALL session input events
			function handleInput(ev) {
				console.log('Session input:', ev.type);
				// Only place on first tap (selectend = tap release)
				if (ev.type === 'selectend') {
					self._placed = true;
				}
			}
			session.addEventListener('selectstart', handleInput);
			session.addEventListener('selectend', handleInput);
			session.addEventListener('select', handleInput);

			// Three.js controller fallback
			const ctrl = self.renderer.xr.getController(0);
			ctrl.addEventListener('selectend', function () {
				console.log('Three.js selectend');
				self._placed = true;
			});
			ctrl.addEventListener('select', function () {
				console.log('Three.js select');
				self._placed = true;
			});
			self.scene.add(ctrl);
		}

		function onSessionEnded() {
			if (self.mymesh !== null) {
				self.scene.remove(self.mymesh);
				self.mymesh = null;
			}
			self.renderer.setAnimationLoop(null);
		}

		navigator.xr.requestSession('immersive-ar', sessionInit).then(onSessionStarted);
	}

	requestHitTestSource() {
		const self = this;
		const session = this.renderer.xr.getSession();
		if (!session) return;

		session.requestReferenceSpace('viewer').then(function (referenceSpace) {
			session.requestHitTestSource({ space: referenceSpace }).then(function (source) {
				self.hitTestSource = source;
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

			// AUTO-PLACE: model follows reticle until user taps to lock it
			if (this.mymesh && this.mymesh.visible && !this._placed) {
				this.mymesh.position.setFromMatrixPosition(this.reticle.matrix);
			}
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
