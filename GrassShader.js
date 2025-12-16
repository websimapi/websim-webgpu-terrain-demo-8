export const GRASS_VERTEX_LOGIC = `
  vec3 transformed = vec3( position );
  vHeight = uv.y;
  
  vec4 instancePosition = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 worldPos = (modelMatrix * instancePosition).xyz;
  vWorldPosition = worldPos;

  // --- WIND SYSTEM (Multi-Layered AAA Approach) ---
  // Use accumulated wind time for variable speed phases
  // Slower time scale for reduced jitter
  float time = uWindTime * 0.3;
  
  // Layer 1: Macro Wind (Broad sweeping waves) - Red Channel
  // Low frequency, high amplitude. Simulates large air masses moving.
  vec2 windUV = worldPos.xz * 0.003 + vec2(time * 0.05, time * 0.02);
  float macroWind = texture2D(uWindNoise, windUV).r;
  
  // Layer 2: Turbulence (Gusts) - Green Channel
  // Medium frequency. Simulates chaotic turbulence within the macro flow.
  vec2 gustUV = worldPos.xz * 0.02 + vec2(time * 0.2, time * 0.1);
  float gustWind = texture2D(uWindNoise, gustUV).g;
  
  // Layer 3: Micro Flutter (Procedural Detail)
  // Low frequency, low amplitude to prevent aliasing/jitter.
  // Scale frequency by strength so it vibrates faster when windy but stays smooth.
  float flutterFreq = 2.0 + (uWindStrength * 2.5);
  float flutter = sin(time * flutterFreq + worldPos.x + worldPos.z * 0.5);
                  
  // Composite Wind Strength (Normalized 0.0 to 1.0)
  float localWindNoise = macroWind * 0.7 + gustWind * 0.3;
  float windStrength = localWindNoise * uWindStrength;
  
  // Attenuate flutter
  float flutterAmp = 0.03 * clamp(uWindStrength, 0.0, 1.5);
  windStrength += flutter * flutterAmp;

  // --- INTERACTION SYSTEM (State-based + Restoration) ---
  
  // 1. Trail History (Persistent deformation from FBO)
  vec2 mapUV = (worldPos.xz + (uTerrainSize * 0.5)) / uTerrainSize;
  mapUV = clamp(mapUV, 0.0, 1.0);
  mapUV.y = 1.0 - mapUV.y; 
  float trailData = texture2D(uTrailMap, mapUV).r;
  
  // 2. Player Immediate Presence (Proximity mask)
  float dist = distance(worldPos.xz, uPlayerPos.xz);
  float playerRadius = 0.7;
  float playerPress = 1.0 - smoothstep(playerRadius * 0.5, playerRadius, dist);
  playerPress = pow(playerPress, 2.0); // Sharper inner circle
  
  // 3. Dynamic Wind Restoration
  // "Wind system continuously applies a restoration force... masked to zero where player is standing."
  // Use stable macro wind for restoration to prevent trails from flickering/jittering.
  
  // Mask: 0.0 if under player (cannot recover), 1.0 if free (can recover)
  float recoveryMask = 1.0 - playerPress;
  
  // Restoration force: Stronger wind lifts grass more.
  // We use a smoother wind approximation here.
  float stableWind = (macroWind * 0.8 + 0.2) * uWindStrength;
  float restorationForce = clamp(stableWind * 0.5 * recoveryMask, 0.0, 0.8);
  
  // Apply restoration to trail:
  // If wind is strong, effective trail reduces (grass bounces up).
  // If wind is calm, trail remains flat.
  float effectiveTrail = trailData * (1.0 - restorationForce);
  
  // Final Crush State: Player weight overrides all recovery
  float totalCrush = max(playerPress, effectiveTrail);
  totalCrush = clamp(totalCrush, 0.0, 1.0);

  // --- DISPLACEMENT ---
  
  // Stiffness: Crushed grass is stiff (0.0), upright is flexible (1.0)
  float stiffness = 1.0 - totalCrush;
  
  // Directional Wind Bend
  vec3 windDir = normalize(vec3(1.0, 0.0, 0.5));
  float bendAmount = windStrength * 1.5 * stiffness * pow(vHeight, 2.0);
  
  transformed.x += windDir.x * bendAmount;
  transformed.z += windDir.z * bendAmount;
  
  // Add flutter to tips
  transformed.y += flutter * flutterAmp * stiffness * vHeight;
  
  // --- REALISTIC CRUSH ROTATION ---
  
  // Determine rotation axis. 
  // If player is close, use push direction.
  // For old trails, use a stable random direction to prevent jittering artifacts.
  
  vec2 playerPushDir = normalize(worldPos.xz - uPlayerPos.xz);
  if (length(worldPos.xz - uPlayerPos.xz) < 0.01) playerPushDir = vec2(1.0, 0.0);
  
  // Procedural stable direction
  float noiseAngle = dot(worldPos.xz, vec2(12.9898, 78.233));
  vec2 randomDir = normalize(vec2(sin(noiseAngle), cos(noiseAngle)));
  
  // Blend direction based on freshness of interaction
  vec2 finalDir = mix(randomDir, playerPushDir, playerPress);
  vec3 crushAxis = normalize(cross(vec3(0, 1, 0), vec3(finalDir.x, 0, finalDir.y)));
  
  // Rotation Angle
  float angle = totalCrush * 1.5; // Up to ~85 degrees
  float c = cos(angle);
  float s = sin(angle);
  vec3 v = transformed;
  
  // Rodrigues rotation
  vec3 rotated = v * c + cross(crushAxis, v) * s + crushAxis * dot(crushAxis, v) * (1.0 - c);
  transformed = rotated;
  
  // Grounding: Sink slightly when crushed to prevent floating roots
  transformed.y -= totalCrush * 0.15 * vHeight;
  
  // --- NORMALS ---
  #ifndef USE_SHADOWMAP
    vec3 n = objectNormal;
    // Rotate normal to match geometry
    n = n * c + cross(crushAxis, n) * s + crushAxis * dot(crushAxis, n) * (1.0 - c);
    // Mix with World Up for softer, translucent lighting look
    objectNormal = normalize(mix(n, vec3(0,1,0), 0.4));
  #endif

  // --- GPU DISTANCE CULLING ---
  float distToCam = distance(worldPos.xz, uCameraPos.xz);
  float cullDist = 90.0;     // Max render distance
  float fadeLen = 15.0;      // Fade transition length
  
  float fade = 1.0 - smoothstep(cullDist - fadeLen, cullDist, distToCam);
  
  // Scale down instances at the edge
  transformed *= fade;
  
  // Collapse vertices if beyond draw distance (saves rasterization)
  if (distToCam > cullDist) {
     transformed = vec3(0.0);
  }
`;

