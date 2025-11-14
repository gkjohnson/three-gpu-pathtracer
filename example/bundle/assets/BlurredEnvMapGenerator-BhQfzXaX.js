import{P as h,W as M,R as c,F as w,D as y,a as F,H as R,E as b,b as U}from"./MaterialBase-byhyp4gt.js";import{F as C}from"./pcg.glsl-Dh-2-BlJ.js";import{u as D}from"./ggx_functions.glsl-BPuHaSoe.js";class G extends U{constructor(){super({uniforms:{envMap:{value:null},blur:{value:0}},vertexShader:`

				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}

			`,fragmentShader:`

				#include <common>
				#include <cube_uv_reflection_fragment>

				${D}

				uniform sampler2D envMap;
				uniform float blur;
				varying vec2 vUv;
				void main() {

					vec3 rayDirection = equirectUvToDirection( vUv );
					gl_FragColor = textureCubeUV( envMap, rayDirection, blur );

				}

			`})}}class B{constructor(e){this.renderer=e,this.pmremGenerator=new h(e),this.copyQuad=new C(new G),this.renderTarget=new M(1,1,{type:w,format:c})}dispose(){this.pmremGenerator.dispose(),this.copyQuad.dispose(),this.renderTarget.dispose()}generate(e,d){const{pmremGenerator:v,renderTarget:i,copyQuad:s,renderer:r}=this,p=v.fromEquirectangular(e),{width:t,height:n}=e.image;i.setSize(t,n),s.material.envMap=p.texture,s.material.blur=d;const g=r.getRenderTarget(),f=r.autoClear;r.setRenderTarget(i),r.autoClear=!0,s.render(r),r.setRenderTarget(g),r.autoClear=f;const u=new Uint16Array(t*n*4),l=new Float32Array(t*n*4);r.readRenderTargetPixels(i,0,0,t,n,l);for(let o=0,T=l.length;o<T;o++)u[o]=y.toHalfFloat(l[o]);const a=new F(u,t,n,c,R);return a.minFilter=e.minFilter,a.magFilter=e.magFilter,a.wrapS=e.wrapS,a.wrapT=e.wrapT,a.mapping=b,a.needsUpdate=!0,p.dispose(),a}}export{B};
