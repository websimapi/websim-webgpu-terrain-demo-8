import * as THREE from 'three';

// Simplex Noise for wind and variation
export function noise(x, z) {
  return Math.sin(x * 0.1) * Math.sin(z * 0.1) + 
         Math.sin(x * 0.3 + 1.2) * Math.cos(z * 0.3 + 2.0) * 0.5;
}

export function generateWindNoiseTexture() {
  // Multi-layered Noise Texture Generation
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  // Fill background with base wind level
  ctx.fillStyle = '#202020'; 
  ctx.fillRect(0, 0, size, size);
  
  // Helper: Draw additive noise blobs
  const drawNoiseLayer = (colorStr, count, minR, maxR) => {
      ctx.globalCompositeOperation = 'screen'; // additive blend
      for (let i = 0; i < count; i++) {
          const x = Math.random() * size;
          const y = Math.random() * size;
          const r = Math.random() * (maxR - minR) + minR;
          
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, colorStr); 
          g.addColorStop(1, 'rgba(0,0,0,0)');
          
          ctx.fillStyle = g;
          
          // Tile wrapping (draw 9 times to ensure seamless tiling)
          for(let dx = -1; dx <= 1; dx++) {
              for(let dy = -1; dy <= 1; dy++) {
                  ctx.save();
                  ctx.translate(dx * size, dy * size);
                  ctx.beginPath();
                  ctx.arc(x, y, r, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.restore();
              }
          }
      }
  };

  // Layer 1: Macro Waves (Red) - Large, sparse
  drawNoiseLayer('rgba(150, 0, 0, 0.4)', 20, 100, 250);
  
  // Layer 2: Turbulence (Green) - Small, dense
  drawNoiseLayer('rgba(0, 150, 0, 0.3)', 60, 30, 80);
  
  // Layer 3: Variance (Blue) - Tiny detail
  drawNoiseLayer('rgba(0, 0, 150, 0.3)', 100, 10, 40);
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  
  return texture;
}

