import * as THREE from 'three';

export function createGrassGeometry() {
  const grassHeight = 0.9; // Slightly taller
  const grassWidth = 0.06; // Wider for better volume/coverage
  const segments = 3;      // More segments for smoother curve
  
  const grassGeo = new THREE.PlaneGeometry(grassWidth, grassHeight, 1, segments);
  grassGeo.translate(0, grassHeight / 2, 0); 
  
  // Tapering
  const posAttribute = grassGeo.attributes.position;
  for (let i = 0; i < posAttribute.count; i++) {
    const y = posAttribute.getY(i);
    const hNorm = y / grassHeight;
    
    // parabolic taper
    const widthScale = 1.0 - Math.pow(hNorm, 1.5); 
    const x = posAttribute.getX(i);
    posAttribute.setX(i, x * widthScale); 
    
    // Curve the blade along Z slightly more
    const curve = Math.pow(hNorm, 2.0) * 0.4;
    posAttribute.setZ(i, posAttribute.getZ(i) - curve);
  }
  grassGeo.computeVertexNormals();
  return grassGeo;
}

