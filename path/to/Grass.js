// ... existing code ...

const GRASS_VERTEX_LOGIC = `
  vec3 transformed = vec3( position );
  vHeight = uv.y;

  vec4 instancePosition = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 worldPos = (modelMatrix * instancePosition).xyz;
  vWorldPosition = worldPos;

  // --- PLAYER INTERACTION ---
  vec2 mapUV = (worldPos.xz + (uTerrainSize * 0.5)) / uTerrainSize;
  mapUV = clamp(mapUV, 0.0, 1.0);
  mapUV.y = 1.0 - mapUV.y; 
  float trailValue = texture2D(uTrailMap, mapUV).r;

  float dist = distance(worldPos.xz, uPlayerPos.xz);
  float radius = 0.5; 
  float immediatePush = 1.0 - smoothstep(0.0, radius, dist);
  // immediatePush = pow(immediatePush, 1.5);

  float totalEffect = max(trailValue, immediatePush);
  totalEffect = clamp(totalEffect, 0.0, 1.0);

  // --- WIND ANIMATION ---
  float windStrength = 1.0 - totalEffect * 0.8; // Reduce wind on crushed grass

  float time = uTime * 0.6;
  float swell = sin(worldPos.x * 0.05 + worldPos.z * 0.05 + time * 0.5) * 0.5 + 0.5;
  float flutter = sin(worldPos.x * 1.5 + time * 2.0) * cos(worldPos.z * 1.0);

  float windForce = (swell * 0.5 + flutter * 0.2) * windStrength;

  // Apply wind bending
  float bend = pow(vHeight, 2.0); 
  transformed.x += windForce * bend * 0.4; 
  transformed.z += windForce * bend * 0.2;

  // --- REALISTIC CRUSHING (Rotation) ---
  // Determine crush direction
  vec2 playerPushDir = normalize(worldPos.xz - uPlayerPos.xz);
  if (length(worldPos.xz - uPlayerPos.xz) < 0.001) playerPushDir = vec2(1.0, 0.0);

  // Stable random direction for old trails
  float randAngle = sin(worldPos.x * 12.9898 + worldPos.z * 78.233) * 43758.5453;
  vec2 noiseDir = vec2(cos(randAngle), sin(randAngle));

  // Blend direction: If immediate interaction, use player dir, else random
  vec2 crushDir2 = mix(noiseDir, playerPushDir, immediatePush);
  vec3 crushDir = normalize(vec3(crushDir2.x, 0.0, crushDir2.y));

  // Rotation Axis (perpendicular to crush direction)
  vec3 rotAxis = normalize(cross(vec3(0.0, 1.0, 0.0), crushDir));

  // Angle
  float crushFactor = smoothstep(0.05, 0.9, totalEffect);
  float angle = crushFactor * 1.4; // Bend up to ~80 degrees

  // Rodrigues Rotation
  float c = cos(angle);
  float s = sin(angle);
  vec3 v = transformed;
  vec3 k = rotAxis;
  vec3 rotated = v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);

  transformed = rotated;

  // Sink slightly to avoid floating base
  transformed.y -= crushFactor * 0.1 * vHeight;

  // Normal adjustment for lighting
  #ifdef USE_SHADOWMAP
     // Shadow pass
  #else
     // Rotate normal for correct lighting
     vec3 n = objectNormal;
     vec3 n_rot = n * c + cross(k, n) * s + k * dot(k, n) * (1.0 - c);
     objectNormal = normalize(n_rot);

     // Mix with Up vector to keep some top-down lighting softness
     objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), 0.4));
  #endif
`;

export class GrassSystem {
  constructor(scene, getTerrainHeight, renderer) {
    this.uniforms = { 
      uTime: { value: 0 }, 
      uPlayerPos: { value: new THREE.Vector3(0, -100, 0) },
      uPlayerVel: { value: new THREE.Vector3(0, 0, 0) },
      uTrailMap: { value: null }, 
      uTerrainSize: { value: 200.0 },
      uSunDir: { value: new THREE.Vector3(0.5, 1.0, 0.5).normalize() }
    };

    this.renderer = renderer;
    this.scene = scene;
    this.getTerrainHeight = getTerrainHeight;
    this.lastPlayerPos = new THREE.Vector3(0, -100, 0);

    this.group = new THREE.Group();
    scene.add(this.group);

    // Initialize the trail persistence system (FBO)
    this.initTrailSystem();

    // Initialize Geometry and Material reused by all chunks
    this.baseGeometry = this.createGeometry();
    this.initMaterials();

    // Create Grass Chunks
    this.chunks = [];
    this.initChunks();
  }

  initTrailSystem() {
    // 1. Render Target for storing trails
    const res = 1024;
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
    const halfSize = 100;
    this.trailCamera = new THREE.OrthographicCamera(-halfSize, halfSize, halfSize, -halfSize, 0.1, 100);
    this.trailCamera.position.set(0, 50, 0);
    this.trailCamera.lookAt(0, 0, 0);
    this.trailCamera.up.set(0, 0, -1);

    // 4. "Brush" - The player's footprint influence
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
      opacity: 0.008, // Slower fade for longer lasting trails
      side: THREE.DoubleSide
    });
    this.fadeQuad = new THREE.Mesh(fadeGeo, fadeMat);
    this.fadeQuad.rotation.x = -Math.PI / 2;
    this.fadeQuad.position.y = -0.1;
    this.trailScene.add(this.fadeQuad);
  }

  createGeometry() {
    const grassHeight = 0.8; 
    const grassWidth = 0.015; // Thinner as requested
    const segments = 2;       

    const grassGeo = new THREE.PlaneGeometry(grassWidth, grassHeight, 1, segments);
    grassGeo.translate(0, grassHeight / 2, 0); 

    // Tapering
    const posAttribute = grassGeo.attributes.position;
    for (let i = 0; i < posAttribute.count; i++) {
      const y = posAttribute.getY(i);
      const hNorm = y / grassHeight;
      const widthScale = 1.0 - Math.pow(hNorm, 2.0); // Sharper taper
      const x = posAttribute.getX(i);
      posAttribute.setX(i, x * widthScale); 

      const curve = Math.pow(hNorm, 2.0) * 0.3;
      posAttribute.setZ(i, posAttribute.getZ(i) - curve);
    }
    grassGeo.computeVertexNormals();
    return grassGeo;
  }

  initMaterials() {
    const patchShader = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);

      shader.vertexShader = `
        uniform float uTime;
        uniform vec3 uPlayerPos;
        uniform vec3 uPlayerVel;
        uniform sampler2D uTrailMap;
        uniform float uTerrainSize;
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
      roughness: 0.8, // Slightly more reflective for "dewy" look
      metalness: 0.0,
      side: THREE.DoubleSide,
      flatShading: false,
      onBeforeCompile: (shader) => {
        patchShader(shader);

        shader.fragmentShader = `
          varying float vHeight;
          varying vec3 vInstanceColor;
          varying vec3 vWorldPosition;
          uniform vec3 uSunDir;
        ` + shader.fragmentShader;

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          `
          vec3 bottomColor = vec3(0.01, 0.05, 0.01);
          vec3 topColor = vec3(0.15, 0.45, 0.05);

          vec3 finalColor = mix(bottomColor, topColor, vHeight);
          finalColor *= vInstanceColor;

          // Fake Ambient Occlusion at bottom
          finalColor *= smoothstep(-0.1, 0.2, vHeight); 

          // --- Translucency / Subsurface Scattering ---
          // Approximate view direction
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);

          // Light passing through grass (Backlighting)
          // High when looking against the light
          float viewDotLight = max(0.0, dot(viewDir, -uSunDir));
          float translucency = pow(viewDotLight, 4.0) * 0.6 * vHeight;

          // Add SSS color (yellow-ish green glow)
          vec3 sssColor = vec3(0.6, 0.8, 0.2) * translucency;

          finalColor += sssColor;

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
    const chunkSize = 25; 
    const density = 250; 

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let x = -terrainSize/2; x < terrainSize/2; x += chunkSize) {
      for (let z = -terrainSize/2; z < terrainSize/2; z += chunkSize) {
        this.createChunk(x, z, chunkSize, density, dummy, color);
      }
    }
  }

  createChunk(startX, startZ, size, density, dummy, color) {
    const area = size * size;
    const totalInstances = Math.floor(area * density);

    const baseCount = Math.floor(totalInstances * 0.2);
    const detailCount = totalInstances - baseCount;

    const meshBase = new THREE.InstancedMesh(this.baseGeometry, this.baseMaterial, baseCount);
    const meshDetail = new THREE.InstancedMesh(this.baseGeometry, this.baseMaterial, detailCount);

    meshBase.castShadow = true;
    meshBase.receiveShadow = true;
    meshDetail.castShadow = true; 
    meshDetail.receiveShadow = true;

    meshBase.customDepthMaterial = this.baseDepthMaterial;
    meshDetail.customDepthMaterial = this.baseDepthMaterial;

    this.fillMesh(meshBase, 0, baseCount, startX, startZ, size, dummy, color);
    this.fillMesh(meshDetail, 0, detailCount, startX, startZ, size, dummy, color);

    this.group.add(meshBase);
    this.group.add(meshDetail);

    this.chunks.push({
      center: new THREE.Vector3(startX + size/2, 0, startZ + size/2),
      meshBase: meshBase,
      meshDetail: meshDetail,
      size: size
    });
  }

  fillMesh(mesh, offset, count, startX, startZ, size, dummy, color) {
    let idx = 0;
    while(idx < count) {
      const x = startX + Math.random() * size;
      const z = startZ + Math.random() * size;

      const y = this.getTerrainHeight(x, z);
      dummy.position.set(x, y, z);

      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.rotation.x = (Math.random() - 0.5) * 0.2; 
      dummy.rotation.z = (Math.random() - 0.5) * 0.2;

      const region = noise(x * 0.015, z * 0.015); 
      const tallFactor = THREE.MathUtils.smoothstep(region, 0.0, 0.8);

      const hScale = 0.4 + Math.random() * 0.4 + (tallFactor * 0.8);

      const wScale = 0.5 + Math.random() * 0.5;

      dummy.scale.set(wScale, hScale, wScale);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);

      const colorNoise = noise(x * 0.05, z * 0.05); 
      if (colorNoise > 0.6) {
         color.setHex(0x7a8a4b); 
      } else {
         const v = 0.5 + Math.random() * 0.4;
         color.setRGB(v * 0.6, v * 0.9, v * 0.4); 
      }
      mesh.setColorAt(idx, color);

      idx++;
    }
  }

  update(time, dt, playerPosition, camera, sunDirection, lodHigh = 128, lodLow = 256) {
    this.uniforms.uTime.value = time;
    if (sunDirection) {
        this.uniforms.uSunDir.value.copy(sunDirection);
    }

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

    if (playerPosition) {
      this.updateLOD(playerPosition, lodHigh, lodLow);
    }
  }

  updateLOD(playerPosition, distHigh, distLow) {
    const chunkPos = new THREE.Vector3();
    const centerPos = new THREE.Vector3(playerPosition.x, 0, playerPosition.z);

    for (let chunk of this.chunks) {
      chunkPos.copy(chunk.center);
      chunkPos.y = 0; 
      const dist = chunkPos.distanceTo(centerPos);

      if (dist < distHigh) {
        chunk.meshBase.visible = true;
        chunk.meshDetail.visible = true;
      } else if (dist < distLow) {
        chunk.meshBase.visible = true;
        chunk.meshDetail.visible = false;
      } else {
        chunk.meshBase.visible = false;
        chunk.meshDetail.visible = false;
      }
    }
  }
}