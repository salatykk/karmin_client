// 3D-сцены Karmin Client (на основе сцены сайта KARMIN).
// Пересборка: npm run scene  (esbuild → renderer/scene.js)
import * as THREE from './vendor/three.module.js';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
let heroActive = true;
window.addEventListener('pointermove', e => {
  mouse.tx = (e.clientX / innerWidth) * 2 - 1;
  mouse.ty = -(e.clientY / innerHeight) * 2 + 1;
});

const NOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

function initHero() {
  const canvas = document.getElementById('hero-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0, 8.2);

  const group = new THREE.Group();
  scene.add(group);

  // Жидкий «кармин»: шейдерная сфера со смещением вершин по шуму и френелем
  const blobMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMouse: { value: new THREE.Vector2() } },
    vertexShader: NOISE + `
      uniform float uTime; uniform vec2 uMouse;
      varying vec3 vN; varying vec3 vView; varying float vD;
      float disp(vec3 p){ return snoise(p*1.15 + uTime*.22)*.38 + snoise(p*3.2 - uTime*.35)*.07; }
      void main(){
        vec3 p = position;
        float d = disp(normalize(p) + vec3(uMouse*.25,0.));
        vec3 np = p + normal * d;
        // приближённая нормаль через соседние точки
        vec3 t = normalize(cross(normal, vec3(0.,1.,0.)+1e-4));
        vec3 b = normalize(cross(normal, t));
        float e=.02;
        vec3 pa = p + t*e; pa += normalize(pa)*disp(normalize(pa)+vec3(uMouse*.25,0.));
        vec3 pb = p + b*e; pb += normalize(pb)*disp(normalize(pb)+vec3(uMouse*.25,0.));
        vec3 n = normalize(cross(pa-np, pb-np));
        if(dot(n, normal) < 0.) n = -n;
        vD = d;
        vec4 mv = modelViewMatrix * vec4(np,1.);
        vN = normalize(normalMatrix * n);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vN; varying vec3 vView; varying float vD;
      void main(){
        vec3 n = normalize(vN);
        vec3 L1 = normalize(vec3(.6,.8,.7)); vec3 L2 = normalize(vec3(-.8,-.3,.4));
        float diff = max(dot(n,L1),0.);
        float rim = pow(1.-max(dot(n,vView),0.), 2.6);
        vec3 h = normalize(L1+vView); float spec = pow(max(dot(n,h),0.), 90.);
        vec3 h2 = normalize(L2+vView); float spec2 = pow(max(dot(n,h2),0.), 40.);
        vec3 deep = vec3(.09,.005,.02); vec3 crimson = vec3(.78,.04,.14); vec3 hot = vec3(1.,.32,.36);
        vec3 col = mix(deep, crimson, diff*.85 + vD*.6);
        col += hot * rim * .9;
        col += vec3(1.,.85,.85) * spec * 1.2 + vec3(1.,.2,.3)*spec2*.5;
        // интерференционные полосы
        col += vec3(.5,.02,.08) * smoothstep(.0,.9, sin(vD*30.+uTime)*.5+.5) * .12;
        gl_FragColor = vec4(col,1.);
      }`
  });
  const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1.45, 56), blobMat);
  group.add(blob);

  // Орбитальные кольца
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff2e47, transparent: true, opacity: .55 });
  const rings = [];
  [[2.3,.006,1.1],[2.75,.004,-.6],[3.2,.003,.35]].forEach(([r,t,tilt],i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, 220), ringMat.clone());
    m.material.opacity = .55 - i*.14;
    m.rotation.x = Math.PI/2 + tilt*.4; m.rotation.y = tilt;
    group.add(m); rings.push(m);
  });
  // спутники на кольцах
  const sats = rings.map((r,i) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(.05 - i*.01, 16, 16), new THREE.MeshBasicMaterial({ color: 0xff8a95 }));
    r.add(s); return s;
  });

  // Частицы
  const N = 1800, pos = new Float32Array(N*3), sizes = new Float32Array(N);
  for (let i=0;i<N;i++){
    const r = 3 + Math.random()*9, th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1);
    pos[i*3] = r*Math.sin(ph)*Math.cos(th); pos[i*3+1] = r*Math.sin(ph)*Math.sin(th)*.6; pos[i*3+2] = r*Math.cos(ph) - 2;
    sizes[i] = Math.random();
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pos,3));
  pg.setAttribute('aSize', new THREE.BufferAttribute(sizes,1));
  const pMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPR: { value: renderer.getPixelRatio() } },
    vertexShader: `uniform float uTime; uniform float uPR; attribute float aSize; varying float vA;
      void main(){ vec3 p=position; p.y += sin(uTime*.3 + position.x)*.15;
        vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
        gl_PointSize = (2. + aSize*5.) * uPR * (6./-mv.z);
        vA = .35 + .65*abs(sin(uTime*.8 + aSize*20.)); }`,
    fragmentShader: `varying float vA; void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,0.,d);
      gl_FragColor = vec4(vec3(1.,.25,.32), a*vA*.8); }`
  });
  const points = new THREE.Points(pg, pMat);
  scene.add(points);

  function resize(){
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w/h; camera.updateProjectionMatrix();
    group.position.x = w > 700 ? 1.9 : 0;
    group.position.y = 0;
    const s = h < 380 ? .82 : 1; group.scale.setScalar(s);
  }
  resize(); addEventListener('resize', resize);

  new ResizeObserver(resize).observe(canvas);
  const clock = new THREE.Clock();
  (function tick(){
    requestAnimationFrame(tick);
    if (!heroActive || document.hidden) return;
    const t = reduce ? 0 : clock.getElapsedTime();
    mouse.x += (mouse.tx - mouse.x)*.05; mouse.y += (mouse.ty - mouse.y)*.05;
    blobMat.uniforms.uTime.value = t; pMat.uniforms.uTime.value = t;
    blobMat.uniforms.uMouse.value.set(mouse.x, mouse.y);
    blob.rotation.y = t*.12; blob.rotation.x = t*.07;
    rings.forEach((r,i) => r.rotation.z = t*(.15 + i*.07)*(i%2?-1:1));
    sats.forEach((s,i) => { const a = t*(.6 - i*.15); const R = [2.3,2.75,3.2][i]; s.position.set(Math.cos(a)*R, Math.sin(a)*R, 0); });
    points.rotation.y = t*.02 + mouse.x*.15; points.rotation.x = mouse.y*.08;
    group.rotation.y = mouse.x*.35; group.rotation.x = -mouse.y*.25;
    renderer.render(scene, camera);
  })();
}


/* ---------- ФОНОВЫЙ ШЕЙДЕР (дымка) ---------- */
function initBg() {
  const canvas = document.getElementById('bg-shader');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene(); const cam = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uTime:{value:0}, uRes:{value:new THREE.Vector2()}, uMouse:{value:new THREE.Vector2()} },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
    fragmentShader: NOISE + `uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse; varying vec2 vUv;
      void main(){ vec2 p = vUv; p.x *= uRes.x/uRes.y; p += uMouse*.04;
        float n = snoise(vec3(p*1.4, uTime*.05))*.5+.5;
        float n2 = snoise(vec3(p*3.5 + n, uTime*.08))*.5+.5;
        float f = smoothstep(.45,1.,n*n2*1.6);
        vec3 col = mix(vec3(.02,.004,.008), vec3(.32,.02,.07), f);
        gl_FragColor = vec4(col, .9); }`
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), mat));
  function resize(){ const w = innerWidth*.5, h = innerHeight*.5; renderer.setSize(w,h,false); mat.uniforms.uRes.value.set(w,h); }
  resize(); addEventListener('resize', resize);
  const clock = new THREE.Clock();
  let last = 0;
  (function tick(now){ requestAnimationFrame(tick);
    if (document.hidden || now - last < 33) return; last = now; // ~30 к/с для экономии ресурсов
    mat.uniforms.uTime.value = reduce ? 0 : clock.getElapsedTime();
    mat.uniforms.uMouse.value.set(mouse.x, mouse.y);
    renderer.render(scene, cam); })(0);
}

window.KarminScene = { setHeroActive: v => { heroActive = v; } };
try { initBg(); initHero(); document.body.classList.add('webgl-ready'); }
catch (err) { console.warn('WebGL недоступен:', err); document.body.classList.add('no-webgl'); }
