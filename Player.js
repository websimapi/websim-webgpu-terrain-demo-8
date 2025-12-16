import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getTerrainNormal } from './Terrain.js';

export class Player {
  constructor(scene, getTerrainHeight) {
    this.scene = scene;
    this.getTerrainHeight = getTerrainHeight;
    this.container = null;
    this.model = null;
    this.mixer = null;
    this.actions = {};
    this.currentAction = null;
    this.moveTarget = null;
    this.zoom = 1.0;
  }

  setZoom(zoom) {
    this.zoom = zoom;
  }

  async load() {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load('https://threejs.org/examples/models/gltf/Soldier.glb', (gltf) => {
        this.model = gltf.scene;
        this.model.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });

        this.model.rotation.y = Math.PI; // Face forward

        this.container = new THREE.Group();
        this.container.add(this.model);

        // Initial pos
        const y = this.getTerrainHeight(0, 0);
        this.container.position.set(0, y, 0);

        this.scene.add(this.container);

        this.mixer = new THREE.AnimationMixer(this.model);
        this.actions.idle = this.mixer.clipAction(gltf.animations.find(c => c.name === 'Idle'));
        this.actions.run = this.mixer.clipAction(gltf.animations.find(c => c.name === 'Run'));

        this.actions.idle.play();
        this.currentAction = this.actions.idle;

        resolve();
      }, undefined, reject);
    });
  }

  setMoveTarget(point) {
    this.moveTarget = point;
    if (this.currentAction !== this.actions.run) {
      this.currentAction.fadeOut(0.2);
      this.actions.run.reset().fadeIn(0.2).play();
      this.currentAction = this.actions.run;
    }
  }

  get isMoving() {
    return !!this.moveTarget;
  }

  update(dt, camera) {
    if (this.mixer) this.mixer.update(dt);
    if (!this.container) return;

    if (this.moveTarget) {
      const charPos = this.container.position.clone();
      charPos.y = 0;
      
      const targetPosFlat = this.moveTarget.clone();
      targetPosFlat.y = 0;

      const direction = new THREE.Vector3().subVectors(targetPosFlat, charPos);
      const dist = direction.length();

      if (dist > 0.2) {
        direction.normalize();
        const moveSpeed = 6;
        const moveVec = direction.multiplyScalar(moveSpeed * dt);
        this.container.position.add(moveVec);

        // Snap to terrain
        const x = this.container.position.x;
        const z = this.container.position.z;
        const h = this.getTerrainHeight(x, z);
        this.container.position.y = h;
        
        // --- Planet Alignment ---
        // 1. Get Normal
        const normal = getTerrainNormal(x, z);
        
        // 2. Align Up vector to Normal while preserving Look Direction
        // Standard LookAt uses (0,1,0) as up. We need custom.
        const lookTarget = this.moveTarget.clone();
        lookTarget.y = this.getTerrainHeight(lookTarget.x, lookTarget.z);
        
        const lookDir = new THREE.Vector3().subVectors(lookTarget, this.container.position).normalize();
        
        // Orthogonalize lookDir against normal so looking "forward" follows the curve
        // Right = look x normal
        const right = new THREE.Vector3().crossVectors(lookDir, normal).normalize();
        // New Forward = normal x right
        const forward = new THREE.Vector3().crossVectors(normal, right).normalize();
        
        const m = new THREE.Matrix4().makeBasis(right, normal, forward);
        this.container.quaternion.setFromRotationMatrix(m);

      } else {
        this.moveTarget = null;
        if (this.currentAction !== this.actions.idle) {
          this.currentAction.fadeOut(0.2);
          this.actions.idle.reset().fadeIn(0.2).play();
          this.currentAction = this.actions.idle;
        }
      }
    } else {
      // Idle alignment
      const x = this.container.position.x;
      const z = this.container.position.z;
      const h = this.getTerrainHeight(x, z);
      this.container.position.y = h;
      
      const normal = getTerrainNormal(x, z);
      
      // Smoothly align Up to normal without spinning
      const currentQ = this.container.quaternion.clone();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(currentQ);
      
      const alignQ = new THREE.Quaternion().setFromUnitVectors(up, normal);
      this.container.quaternion.premultiply(alignQ);
    }

    if (camera) this.updateCamera(camera);
  }

  updateCamera(camera) {
    const idealOffset = new THREE.Vector3(0, 8 * this.zoom, -12 * this.zoom);
    idealOffset.applyQuaternion(this.container.quaternion);
    idealOffset.add(this.container.position);

    const idealLookAt = new THREE.Vector3(0, 2, 0);
    idealLookAt.applyQuaternion(this.container.quaternion);
    idealLookAt.add(this.container.position);

    camera.position.lerp(idealOffset, 0.05);

    const tempCam = camera.clone();
    tempCam.lookAt(idealLookAt);
    camera.quaternion.slerp(tempCam.quaternion, 0.05);
  }

  getPosition() {
    return this.container ? this.container.position : new THREE.Vector3();
  }
}