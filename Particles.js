import * as THREE from 'three';

export function createFireflies(scene) {
    const particleGeo = new THREE.BufferGeometry();
    const particleCount = 200;
    const pPos = new Float32Array(particleCount * 3);
    const velocities = [];

    for (let i = 0; i < particleCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 60;
      pPos[i * 3 + 1] = Math.random() * 10 + 2;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 60;
      velocities.push({
         x: (Math.random() - 0.5) * 0.05, 
         y: (Math.random() - 0.5) * 0.02, 
         z: (Math.random() - 0.5) * 0.05
      });
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0xffaa00,
      size: 0.2,
      transparent: true,
      blending: THREE.AdditiveBlending
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    particles.userData = { velocities };
    scene.add(particles);
    return particles;
}

export function updateFireflies(particles) {
    if (!particles) return;
    const pos = particles.geometry.attributes.position.array;
    const vels = particles.userData.velocities;
    for(let i=0; i<vels.length; i++) {
      pos[i*3] += vels[i].x;
      pos[i*3+1] += vels[i].y;
      pos[i*3+2] += vels[i].z;
      
      if(pos[i*3+1] < 1 || pos[i*3+1] > 15) vels[i].y *= -1;
      if(Math.abs(pos[i*3]) > 60) vels[i].x *= -1;
      if(Math.abs(pos[i*3+2]) > 60) vels[i].z *= -1;
    }
    particles.geometry.attributes.position.needsUpdate = true;
}