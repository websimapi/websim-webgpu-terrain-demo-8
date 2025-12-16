import * as THREE from 'three';

export const PLANET_RADIUS = 1200.0;

export function getTerrainHeight(x, z) {
  // Base Noise
  const detail = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 3 +
         Math.sin(x * 0.1) * Math.cos(z * 0.1) * 1.5 +
         Math.sin(x * 0.2) * Math.cos(z * 0.2) * 0.5;
         
  // Spherical/Planetary Curvature Falloff
  // y = R - sqrt(R^2 - x^2 - z^2) approx (x^2 + z^2) / 2R
  const distSq = x*x + z*z;
  const curvature = distSq / (2.0 * PLANET_RADIUS);
  
  return detail - curvature;
}

export function getTerrainNormal(x, z) {
    const eps = 0.1;
    const h = getTerrainHeight(x, z);
    const hx = getTerrainHeight(x + eps, z);
    const hz = getTerrainHeight(x, z + eps);
    
    // Calculate slope vectors
    const n = new THREE.Vector3(h - hx, eps, h - hz).normalize();
    return n;
}

export function createTerrain(scene) {
  const terrainGroup = new THREE.Group();
  scene.add(terrainGroup);
  
  // Chunk Settings
  const chunkSize = 100;
  const chunksX = 3; 
  const chunksZ = 3;
  
  // Create a grid of chunks to satisfy "chunk based map"
  const geometry = new THREE.PlaneGeometry(chunkSize, chunkSize, 64, 64);
  const material = new THREE.MeshStandardMaterial({
    color: 0x2a3f2a,
    roughness: 0.9,
    metalness: 0.1,
    flatShading: false
  });

  for (let cx = -1; cx <= 1; cx++) {
    for (let cz = -1; cz <= 1; cz++) {
        const chunkGeo = geometry.clone();
        const offsetX = cx * chunkSize;
        const offsetZ = cz * chunkSize;
        
        const posAttr = chunkGeo.attributes.position;
        
        for (let i = 0; i < posAttr.count; i++) {
            // Local coords
            const lx = posAttr.getX(i);
            const ly = posAttr.getY(i); // This corresponds to World -Z because of rotation later
            
            // World coords
            const wx = lx + offsetX;
            const wz = -ly + offsetZ; 
            
            const height = getTerrainHeight(wx, wz);
            posAttr.setZ(i, height);
        }
        
        chunkGeo.computeVertexNormals();
        
        const mesh = new THREE.Mesh(chunkGeo, material);
        mesh.position.set(offsetX, 0, offsetZ); // Just X/Z offset
        mesh.rotation.x = -Math.PI / 2;
        mesh.receiveShadow = true;
        
        // Tag it for raycasting
        mesh.name = "TerrainChunk";
        terrainGroup.add(mesh);
    }
  }
  
  return terrainGroup;
}

