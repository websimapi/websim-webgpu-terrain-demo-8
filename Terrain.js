import * as THREE from 'three';

export function getTerrainHeight(x, z) {
  return Math.sin(x * 0.05) * Math.cos(z * 0.05) * 3 +
         Math.sin(x * 0.1) * Math.cos(z * 0.1) * 1.5 +
         Math.sin(x * 0.2) * Math.cos(z * 0.2) * 0.5;
}

export function createTerrain(scene) {
  const terrainGeo = new THREE.PlaneGeometry(200, 200, 128, 128);
  const vertices = terrainGeo.attributes.position.array;
  
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    vertices[i + 2] = getTerrainHeight(x, y);
  }
  terrainGeo.computeVertexNormals();

  const terrainMat = new THREE.MeshStandardMaterial({
    color: 0x2a3f2a, // Darker ground to contrast with grass
    roughness: 1.0,
    metalness: 0.0,
    flatShading: false
  });

  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.rotation.x = -Math.PI / 2;
  terrain.receiveShadow = true;
  scene.add(terrain);
  
  return terrain;
}

