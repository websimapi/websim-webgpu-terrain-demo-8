import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Sun, Wind, Sparkles, MousePointer2, Loader2 } from 'lucide-react';
import htm from 'htm';

// New imports
import { createTerrain, getTerrainHeight } from './Terrain.js';
import { GrassSystem } from './Grass.js';
import { Player } from './Player.js';
import { createFireflies, updateFireflies } from './Particles.js';

const html = htm.bind(React.createElement);

export default function WebGPUTerrainDemo() {
  const containerRef = useRef(null);
  const [status, setStatus] = useState('initializing');
  const [stats, setStats] = useState({ fps: 0, triangles: 0 });
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // removed local variable declarations for terrain, grass, particles, player
    // replaced with system instances
    let renderer, scene, camera;
    let grassSystem, player, particles;
    let terrain; // still need ref for raycasting
    let sun; // Expose sun for updating
    
    let clickMarker;
    let cleanupClick;

    let zoomLevel = 1.0;
    
    let animationId;
    let time = 0;

    async function init() {
      try {
        setStatus('Initializing 3D Scene...');

        // Scene setup
        scene = new THREE.Scene();
        sceneRef.current = scene;
        scene.background = new THREE.Color(0x87ceeb);
        scene.fog = new THREE.Fog(0x87ceeb, 20, 100);

        // Camera
        camera = new THREE.PerspectiveCamera(
          60,
          containerRef.current.offsetWidth / containerRef.current.offsetHeight,
          0.1,
          500
        );
        camera.position.set(0, 15, 20);
        camera.lookAt(0, 0, 0);

        // Standard WebGL Renderer
        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(containerRef.current.offsetWidth, containerRef.current.offsetHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Dynamic Sky
        const skyGeo = new THREE.SphereGeometry(300, 32, 32);
        const skyMat = new THREE.MeshBasicMaterial({
          color: 0x87ceeb,
          side: THREE.BackSide
        });
        const sky = new THREE.Mesh(skyGeo, skyMat);
        scene.add(sky);

        // Lighting
        sun = new THREE.DirectionalLight(0xfff5e6, 2.0);
        sun.position.set(50, 60, 30);
        sun.castShadow = true;
        sun.shadow.mapSize.width = 4096;
        sun.shadow.mapSize.height = 4096;
        sun.shadow.camera.near = 0.5;
        sun.shadow.camera.far = 200;
        
        // Increased shadow camera coverage for better LOD support
        const shadowSize = 100;
        sun.shadow.camera.left = -shadowSize;
        sun.shadow.camera.right = shadowSize;
        sun.shadow.camera.top = shadowSize;
        sun.shadow.camera.bottom = -shadowSize;
        
        sun.shadow.bias = -0.0001; 
        sun.shadow.normalBias = 0.05; // Helps with self-shadowing artifacts
        scene.add(sun);
        scene.add(sun.target);

        const ambient = new THREE.AmbientLight(0x404060, 0.6);
        scene.add(ambient);

        const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x4a6f3a, 0.6);
        scene.add(hemiLight);

        // removed inline Terrain Generation logic 
        // replaced with module call
        terrain = createTerrain(scene);

        // removed inline Grass Generation logic
        // replaced with module call
        grassSystem = new GrassSystem(scene, getTerrainHeight, renderer);

        // removed inline Fireflies logic
        // replaced with module call
        particles = createFireflies(scene);

        // Click Marker
        const markerGeo = new THREE.RingGeometry(0.3, 0.5, 32);
        const markerMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
        clickMarker = new THREE.Mesh(markerGeo, markerMat);
        clickMarker.rotation.x = -Math.PI / 2;
        clickMarker.visible = false;
        scene.add(clickMarker);

        // Character Loading
        setStatus('Loading Character...');
        
        // removed inline Character Loading logic
        // replaced with Player class
        player = new Player(scene, getTerrainHeight);
        try {
            await player.load();
            setStatus('rendering');
        } catch (err) {
            console.error("Failed to load character", err);
            setStatus('Error loading character');
        }

        // Input Handling
        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();

        function onPointerDown(event) {
          if (!terrain) return;
          
          const rect = renderer.domElement.getBoundingClientRect();
          pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

          raycaster.setFromCamera(pointer, camera);
          const intersects = raycaster.intersectObject(terrain);

          if (intersects.length > 0) {
            const point = intersects[0].point;
            
            clickMarker.position.copy(point);
            clickMarker.position.y += 0.1;
            clickMarker.visible = true;

            player.setMoveTarget(point);
          }
        }
        
        renderer.domElement.addEventListener('pointerdown', onPointerDown);

        const onWheel = (e) => {
           // Zoom limits: 0.3 (close) to 1.5 (far)
           zoomLevel += e.deltaY * 0.001;
           zoomLevel = Math.max(0.3, Math.min(zoomLevel, 1.5));
           e.preventDefault();
        };
        window.addEventListener('wheel', onWheel, { passive: false });

        cleanupClick = () => {
          if (renderer.domElement) renderer.domElement.removeEventListener('pointerdown', onPointerDown);
          window.removeEventListener('wheel', onWheel);
        };

        // Animation Loop
        let lastTime = performance.now();
        let frameCount = 0;
        let fpsTime = 0;

        function animate() {
          animationId = requestAnimationFrame(animate);

          const currentTime = performance.now();
          const deltaTime = currentTime - lastTime;
          lastTime = currentTime;
          time = currentTime * 0.001;

          // Stats
          frameCount++;
          fpsTime += deltaTime;
          if (fpsTime >= 1000) {
            setStats({
              fps: Math.round(frameCount * 1000 / fpsTime),
              triangles: renderer.info.render.triangles
            });
            frameCount = 0;
            fpsTime = 0;
          }

          // Update player zoom
          player.setZoom(zoomLevel);
          player.update(deltaTime * 0.001, camera);

          // Update Sun to follow player for high quality shadows everywhere
          const playerPos = player.getPosition();
          if (playerPos) {
             const sunOffset = new THREE.Vector3(50, 60, 30);
             sun.position.copy(playerPos).add(sunOffset);
             sun.target.position.copy(playerPos);
             sun.target.updateMatrixWorld();
          }

          // Grass update with current player position
          // LOD is now handled by GPU in Vertex Shader for single draw call optimization
          const sunDir = new THREE.Vector3(50, 60, 30).normalize();
          grassSystem.update(time, deltaTime * 0.001, player.getPosition(), camera, sunDir);
          
          // Hide marker if player stopped
          if (!player.isMoving) {
              clickMarker.visible = false;
          }

          // removed inline Particles updates
          // replaced with module update
          updateFireflies(particles);

          renderer.render(scene, camera);
        }

        animate();

      } catch (err) {
        console.error("Init Error:", err);
        setStatus(`Error: ${err.message}`);
      }
    }

    function handleResize() {
      if (!containerRef.current || !rendererRef.current) return;
      const width = containerRef.current.offsetWidth;
      const height = containerRef.current.offsetHeight;
      
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    }

    init();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (cleanupClick) cleanupClick();
      if (animationId) cancelAnimationFrame(animationId);
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
      if (sceneRef.current) {
        // basic cleanup
        sceneRef.current.traverse(o => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
            else o.material.dispose();
          }
        });
      }
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, []);

  return html`
    <div className="w-full h-screen bg-black relative overflow-hidden font-sans select-none">
      <div ref=${containerRef} className="w-full h-full" />
      
      ${status !== 'rendering' && html`
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 backdrop-blur-sm z-50">
          <div className="text-center text-white p-8">
            <${Loader2} className="w-12 h-12 mx-auto mb-4 text-blue-400 animate-spin" />
            <h2 className="text-2xl font-bold mb-2">Loading Scene</h2>
            <p className="text-gray-400 font-mono text-sm">${status}</p>
          </div>
        </div>
      `}

      ${status === 'rendering' && html`
        <${React.Fragment}>
          <div className="absolute top-4 left-4 pointer-events-none">
            <div className="bg-black/60 backdrop-blur-md text-white p-4 rounded-xl border border-white/10 shadow-xl">
              <h2 className="text-lg font-bold mb-2 flex items-center gap-2">
                <${Sparkles} className="w-4 h-4 text-yellow-400" />
                Interactive Terrain
              </h2>
              <div className="space-y-1 text-xs text-gray-300">
                <div className="flex items-center gap-2">
                  <${MousePointer2} className="w-3 h-3 text-blue-400" />
                  <span>Click ground to move</span>
                </div>
                <div className="flex items-center gap-2">
                  <${Wind} className="w-3 h-3 text-green-400" />
                  <span>Procedural Vegetation</span>
                </div>
                <div className="pt-2 mt-2 border-t border-white/10 flex justify-between font-mono text-[10px] opacity-70">
                  <span>${stats.fps} FPS</span>
                  <span>${(stats.triangles / 1000).toFixed(1)}k Tris</span>
                </div>
              </div>
            </div>
          </div>
        </${React.Fragment}>
      `}
    </div>
  `;
}

