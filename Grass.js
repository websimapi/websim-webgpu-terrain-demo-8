import * as THREE from 'three';
import { GRASS_VERTEX_LOGIC } from './GrassShader.js';
import { createGrassGeometry } from './GrassGeometry.js';
import { noise, generateWindNoiseTexture } from './GrassUtils.js';

// removed function noise(x, z) {}
// removed const GRASS_VERTEX_LOGIC = `...`;

export class GrassSystem {
  constructor(scene, getTerrainHeight, renderer) {
    // Generate Wind Noise Texture
    const windTex = generateWindNoiseTexture();

    this.uniforms = { 
      uTime: { value: 0 }, 
      uPlayerPos: { value: new THREE.Vector3(0, -100, 0) },
      uPlayerVel: { value: new THREE.Vector3(0, 0, 0) },
      uTrailMap: { value: null }, 
      uTerrainSize: { value: 200.0 },
      uWindNoise: { value: windTex },
      uWindTime: { value: 0 },
      uWindStrength: { value: 1.0 },
      uCameraPos: { value: new THREE.Vector3() }
    };
    
    this.windTime = 0;
    this.currentWindStrength = 1.0;

    this.renderer = renderer;
    this.scene = scene;
    this.getTerrainHeight = getTerrainHeight;
    this.lastPlayerPos = new THREE.Vector3(0, -100, 0);
    
    this.group = new THREE.Group();
    scene.add(this.group);

    // Initialize the trail persistence system (FBO)
    this.initTrailSystem();
    
    // Initialize Geometry and Material reused by all chunks
    this.baseGeometry = createGrassGeometry();
    this.initMaterials();

    // Create Chunked Grass System for Frustum Culling & Density
    this.initChunks();
  }

  initTrailSystem() {
    // 1. Render Target for storing trails
    const res = 1024; // Higher resolution for cleaner trails
    this.trailTarget = new THREE.WebGLRenderTarget(res, res, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RedFormat,
      type: THREE.HalfFloatType,
    });
    
    this.uniforms.uTrailMap.value = this.trailTarget.texture;

    // 2. Scene for the trail rendering
    this.trailScene = new THREE.Scene();
    
    // 3. Camera covering the terrain
    // Terrain is 200x200, centered at 0,0
    const halfSize = 100;
    this.trailCamera = new THREE.OrthographicCamera(-halfSize, halfSize, halfSize, -halfSize, 0.1, 100);
    this.trailCamera.position.set(0, 50, 0);
    this.trailCamera.lookAt(0, 0, 0);
    // Orient camera so Top of texture maps to -Z (Standard UV mapping alignment)
    this.trailCamera.up.set(0, 0, -1);

    // 4. "Brush" - The player's footprint influence
    // Smaller brush for accurate feet position
    const brushGeo = new THREE.PlaneGeometry(0.8, 0.8); 
    const brushMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255, 255, 255, 1.0)'); 
    grd.addColorStop(0.4, 'rgba(255, 255, 255, 0.8)');
    grd.addColorStop(1, 'rgba(0, 0, 0, 0)'); 
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 64, 64);
    
    const brushTex = new THREE.CanvasTexture(canvas);
    brushMat.map = brushTex;
    brushMat.alphaMap = brushTex;
    
    this.brush = new THREE.Mesh(brushGeo, brushMat);
    this.brush.rotation.x = -Math.PI / 2;
    this.trailScene.add(this.brush);
    
    // 5. "Fade" Quad
    const fadeGeo = new THREE.PlaneGeometry(200, 200);
    const fadeMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.005, // Very slow fade to allow wind recovery mechanic to shine
      side: THREE.DoubleSide
    });
    this.fadeQuad = new THREE.Mesh(fadeGeo, fadeMat);
    this.fadeQuad.rotation.x = -Math.PI / 2;
    this.fadeQuad.position.y = -0.1;
    this.trailScene.add(this.fadeQuad);
  }

  // removed createGeometry() {}

  initMaterials() {
    const patchShader = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      
      shader.vertexShader = `
        uniform float uTime;
        uniform vec3 uPlayerPos;
        uniform vec3 uPlayerVel;
        uniform sampler2D uTrailMap;
        uniform float uTerrainSize;
        uniform sampler2D uWindNoise;
        uniform float uWindTime;
        uniform float uWindStrength;
        uniform vec3 uCameraPos;
        varying float vHeight;
        varying vec3 vWorldPosition;
        ${shader.vertexShader}
      `;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        GRASS_VERTEX_LOGIC
      );
    };

    // 1. Visible Material
    this.baseMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, 
      roughness: 1.0, 
      metalness: 0.0,
      side: THREE.DoubleSide,
      flatShading: false,
      onBeforeCompile: (shader) => {
        patchShader(shader);
        
        shader.fragmentShader = `
          varying float vHeight;
          varying vec3 vInstanceColor;
        ` + shader.fragmentShader;
        
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          `
          vec3 bottomColor = vec3(0.01, 0.08, 0.01);
          vec3 topColor = vec3(0.2, 0.5, 0.1);
          
          vec3 finalColor = mix(bottomColor, topColor, vHeight);
          finalColor *= vInstanceColor;
          finalColor *= smoothstep(-0.1, 0.3, vHeight); // AO
          diffuseColor.rgb = finalColor;
          `
        );
        
        // Inject vInstanceColor support in vertex for main material
        shader.vertexShader = shader.vertexShader.replace(
           'varying vec3 vWorldPosition;',
           'varying vec3 vWorldPosition; varying vec3 vInstanceColor;'
        );
        shader.vertexShader = shader.vertexShader.replace(
           'vHeight = uv.y;',
           'vHeight = uv.y; vInstanceColor = instanceColor;'
        );
      }
    });

    // 2. Depth Material (For Shadows)
    this.baseDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      onBeforeCompile: (shader) => {
        patchShader(shader);
      }
    });
  }

  initChunks() {
    const terrainSize = 200;
    const chunkSize = 20; 
    // Higher density: ~40 instances per unit sq (was ~6)
    // 20x20 chunk = 400 area * 40 = 16,000 instances per chunk
    // 100 chunks = 1.6 million instances total (Culled by frustum)
    const density = 45; 

    // Define generic bounding sphere for a 20x20 chunk centered at 0,0,0
    // Radius approx 15 covers the square diagonal
    this.baseGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 16.0);

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let x = -terrainSize / 2; x < terrainSize / 2; x += chunkSize) {
      for (let z = -terrainSize / 2; z < terrainSize / 2; z += chunkSize) {
        
        const centerX = x + chunkSize / 2;
        const centerZ = z + chunkSize / 2;
        
        const area = chunkSize * chunkSize;
        const instanceCount = Math.floor(area * density);
        
        const mesh = new THREE.InstancedMesh(this.baseGeometry, this.baseMaterial, instanceCount);
        
        // Offset the mesh to the center of the chunk
        mesh.position.set(centerX, 0, centerZ);
        
        mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.customDepthMaterial = this.baseDepthMaterial;
        
        let idx = 0;
        while(idx < instanceCount) {
          // Local position within chunk
          const lx = (Math.random() - 0.5) * chunkSize;
          const lz = (Math.random() - 0.5) * chunkSize;
          
          // World position for terrain height lookup
          const wx = centerX + lx;
          const wz = centerZ + lz;
          
          const y = this.getTerrainHeight(wx, wz);
          
          // Position relative to mesh (mesh is at y=0)
          dummy.position.set(lx, y, lz);
          
          dummy.rotation.y = Math.random() * Math.PI * 2;
          // Random slight tilt
          dummy.rotation.x = (Math.random() - 0.5) * 0.3; 
          dummy.rotation.z = (Math.random() - 0.5) * 0.3;

          // Region based height variation
          const region = noise(wx * 0.015, wz * 0.015); 
          const tallFactor = THREE.MathUtils.smoothstep(region, 0.0, 0.8);
          
          const hScale = 0.4 + Math.random() * 0.5 + (tallFactor * 0.7);
          const wScale = 0.5 + Math.random() * 0.5;
          
          dummy.scale.set(wScale, hScale, wScale);
          dummy.updateMatrix();
          mesh.setMatrixAt(idx, dummy.matrix);
          
          // Color Variation
          const colorNoise = noise(wx * 0.05, wz * 0.05); 
          if (colorNoise > 0.6) {
             color.setHex(0x7a8a4b); 
          } else {
             const v = 0.5 + Math.random() * 0.4;
             color.setRGB(v * 0.6, v * 0.9, v * 0.4); 
          }
          mesh.setColorAt(idx, color);
          
          idx++;
        }
        
        this.group.add(mesh);
      }
    }
  }

  update(time, dt, playerPosition, camera, sunDirection) {
    this.uniforms.uTime.value = time;
    
    // --- Wind Dynamics ---
    // Calculate global wind variance (Gusts and Lulls)
    // Combine two sine waves for irregular "breathing" of the wind
    const cycle1 = Math.sin(time * 0.1);         // Slow 60s cycle
    const cycle2 = Math.sin(time * 0.4 + 2.0);   // Faster 15s cycle
    
    // Combined normalized -1 to 1
    const rawWind = (cycle1 + cycle2 * 0.5) / 1.5; 
    
    // Map to strength multiplier:
    // Calm (0.2) to Stormy (1.6)
    // Use smoothstep to make the 'states' linger slightly
    const normWind = THREE.MathUtils.smoothstep(rawWind, -0.8, 0.8);
    const targetStrength = THREE.MathUtils.lerp(0.1, 1.8, normWind);
    
    // Smoothly transition current strength (inertia)
    this.currentWindStrength += (targetStrength - this.currentWindStrength) * dt * 0.2;
    
    // Accumulate wind time based on current speed
    // This makes the waves move faster when wind is stronger
    this.windTime += dt * this.currentWindStrength;

    this.uniforms.uWindTime.value = this.windTime;
    this.uniforms.uWindStrength.value = this.currentWindStrength;

    if (playerPosition) {
      this.brush.position.set(playerPosition.x, 0, playerPosition.z);

      if (this.renderer && this.trailTarget) {
        const currentRenderTarget = this.renderer.getRenderTarget();
        const currentAutoClear = this.renderer.autoClear;
        
        this.renderer.setRenderTarget(this.trailTarget);
        this.renderer.autoClear = false; 
        
        this.renderer.render(this.trailScene, this.trailCamera);
        
        this.renderer.setRenderTarget(currentRenderTarget);
        this.renderer.autoClear = currentAutoClear;
      }
      
      this.uniforms.uPlayerPos.value.copy(playerPosition);
      
      if (dt > 0.0001) {
        const vel = new THREE.Vector3()
          .subVectors(playerPosition, this.lastPlayerPos)
          .divideScalar(dt);
        this.uniforms.uPlayerVel.value.copy(vel);
      }
      this.lastPlayerPos.copy(playerPosition);
    }

    if (camera) {
       this.uniforms.uCameraPos.value.copy(camera.position);
    }
  }
}

