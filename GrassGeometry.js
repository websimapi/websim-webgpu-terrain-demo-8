import * as THREE from 'three';

export function createGrassGeometry() {
  const grassHeight = 0.8; 
  const grassWidth = 0.04; // Wider for single-draw optimization
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

