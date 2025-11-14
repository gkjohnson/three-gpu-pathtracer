import{a as w,R,F as E,E as B,u as x,w as D,d as T,V as f,ap as L,C as b,m as N,aW as P,W,D as G,H as V,aX as H,aN as O,aP as C,av as X,a1 as j,aY as Y,aZ as $}from"./MaterialBase-byhyp4gt.js";import{F as U,P as Q,h as Z,j as J,k as K}from"./pcg.glsl-Dh-2-BlJ.js";import{a as k}from"./PathTracingRenderer-N-9Lxrjr.js";import{u as ee}from"./ggx_functions.glsl-BPuHaSoe.js";const p=new f,S=new f,g=new L,v=new b;class te extends w{constructor(e=512,t=512){super(new Float32Array(e*t*4),e,t,R,E,B,x,D,T,T),this.generationCallback=null}update(){this.dispose(),this.needsUpdate=!0;const{data:e,width:t,height:r}=this.image;for(let i=0;i<t;i++)for(let a=0;a<r;a++){S.set(t,r),p.set(i/t,a/r),p.x-=.5,p.y=1-p.y,g.theta=p.x*2*Math.PI,g.phi=p.y*Math.PI,g.radius=1,this.generationCallback(g,p,S,v);const n=4*(a*t+i);e[n+0]=v.r,e[n+1]=v.g,e[n+2]=v.b,e[n+3]=1}}copy(e){return super.copy(e),this.generationCallback=e.generationCallback,this}}const M=new N;class ae extends te{constructor(e=512){super(e,e),this.topColor=new b().set(16777215),this.bottomColor=new b().set(0),this.exponent=2,this.generationCallback=(t,r,i,a)=>{M.setFromSpherical(t);const s=M.y*.5+.5;a.lerpColors(this.bottomColor,this.topColor,s**this.exponent)}}copy(e){return super.copy(e),this.topColor.copy(e.topColor),this.bottomColor.copy(e.bottomColor),this}}class re extends P{get map(){return this.uniforms.map.value}set map(e){this.uniforms.map.value=e}get opacity(){return this.uniforms.opacity.value}set opacity(e){this.uniforms&&(this.uniforms.opacity.value=e)}constructor(e){super({uniforms:{map:{value:null},opacity:{value:1}},vertexShader:`
				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}
			`,fragmentShader:`
				uniform sampler2D map;
				uniform float opacity;
				varying vec2 vUv;

				vec4 clampedTexelFatch( sampler2D map, ivec2 px, int lod ) {

					vec4 res = texelFetch( map, ivec2( px.x, px.y ), 0 );

					#if defined( TONE_MAPPING )

					res.xyz = toneMapping( res.xyz );

					#endif

			  		return linearToOutputTexel( res );

				}

				void main() {

					vec2 size = vec2( textureSize( map, 0 ) );
					vec2 pxUv = vUv * size;
					vec2 pxCurr = floor( pxUv );
					vec2 pxFrac = fract( pxUv ) - 0.5;
					vec2 pxOffset;
					pxOffset.x = pxFrac.x > 0.0 ? 1.0 : - 1.0;
					pxOffset.y = pxFrac.y > 0.0 ? 1.0 : - 1.0;

					vec2 pxNext = clamp( pxOffset + pxCurr, vec2( 0.0 ), size - 1.0 );
					vec2 alpha = abs( pxFrac );

					vec4 p1 = mix(
						clampedTexelFatch( map, ivec2( pxCurr.x, pxCurr.y ), 0 ),
						clampedTexelFatch( map, ivec2( pxNext.x, pxCurr.y ), 0 ),
						alpha.x
					);

					vec4 p2 = mix(
						clampedTexelFatch( map, ivec2( pxCurr.x, pxNext.y ), 0 ),
						clampedTexelFatch( map, ivec2( pxNext.x, pxNext.y ), 0 ),
						alpha.x
					);

					gl_FragColor = mix( p1, p2, alpha.y );
					gl_FragColor.a *= opacity;
					#include <premultiplied_alpha_fragment>

				}
			`}),this.setValues(e)}}class ie extends P{constructor(){super({uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:`
				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,fragmentShader:`
				#define ENVMAP_TYPE_CUBE_UV

				uniform samplerCube envMap;
				uniform float flipEnvMap;
				varying vec2 vUv;

				#include <common>
				#include <cube_uv_reflection_fragment>

				${ee}

				void main() {

					vec3 rayDirection = equirectUvToDirection( vUv );
					rayDirection.x *= flipEnvMap;
					gl_FragColor = textureCube( envMap, rayDirection );

				}`}),this.depthWrite=!1,this.depthTest=!1}}class F{constructor(e){this._renderer=e,this._quad=new U(new ie)}generate(e,t=null,r=null){if(!e.isCubeTexture)throw new Error("CubeToEquirectMaterial: Source can only be cube textures.");const i=e.images[0],a=this._renderer,s=this._quad;t===null&&(t=4*i.height),r===null&&(r=2*i.height);const n=new W(t,r,{type:E,colorSpace:i.colorSpace}),l=i.height,m=Math.log2(l)-2,c=1/l,A=1/(3*Math.max(Math.pow(2,m),112));s.material.defines.CUBEUV_MAX_MIP=`${m}.0`,s.material.defines.CUBEUV_TEXEL_WIDTH=A,s.material.defines.CUBEUV_TEXEL_HEIGHT=c,s.material.uniforms.envMap.value=e,s.material.uniforms.flipEnvMap.value=e.isRenderTargetTexture?1:-1,s.material.needsUpdate=!0;const q=a.getRenderTarget(),z=a.autoClear;a.autoClear=!0,a.setRenderTarget(n),s.render(a),a.setRenderTarget(q),a.autoClear=z;const y=new Uint16Array(t*r*4),_=new Float32Array(t*r*4);a.readRenderTargetPixels(n,0,0,t,r,_),n.dispose();for(let d=0,I=_.length;d<I;d++)y[d]=G.toHalfFloat(_[d]);const u=new w(y,t,r,R,V);return u.minFilter=H,u.magFilter=T,u.wrapS=x,u.wrapT=x,u.mapping=B,u.needsUpdate=!0,u}dispose(){this._quad.dispose()}}function se(o){return o.extensions.get("EXT_float_blend")}const h=new f;class ue{get multipleImportanceSampling(){return!!this._pathTracer.material.defines.FEATURE_MIS}set multipleImportanceSampling(e){this._pathTracer.material.setDefine("FEATURE_MIS",e?1:0)}get transmissiveBounces(){return this._pathTracer.material.transmissiveBounces}set transmissiveBounces(e){this._pathTracer.material.transmissiveBounces=e}get bounces(){return this._pathTracer.material.bounces}set bounces(e){this._pathTracer.material.bounces=e}get filterGlossyFactor(){return this._pathTracer.material.filterGlossyFactor}set filterGlossyFactor(e){this._pathTracer.material.filterGlossyFactor=e}get samples(){return this._pathTracer.samples}get target(){return this._pathTracer.target}get tiles(){return this._pathTracer.tiles}get stableNoise(){return this._pathTracer.stableNoise}set stableNoise(e){this._pathTracer.stableNoise=e}get isCompiling(){return!!this._pathTracer.isCompiling}constructor(e){this._renderer=e,this._generator=new Q,this._pathTracer=new k(e),this._queueReset=!1,this._clock=new O,this._compilePromise=null,this._lowResPathTracer=new k(e),this._lowResPathTracer.tiles.set(1,1),this._quad=new U(new re({map:null,transparent:!0,blending:C,premultipliedAlpha:e.getContextAttributes().premultipliedAlpha})),this._materials=null,this._previousEnvironment=null,this._previousBackground=null,this._internalBackground=null,this.renderDelay=100,this.minSamples=5,this.fadeDuration=500,this.enablePathTracing=!0,this.pausePathTracing=!1,this.dynamicLowRes=!1,this.lowResScale=.25,this.renderScale=1,this.synchronizeRenderSize=!0,this.rasterizeScene=!0,this.renderToCanvas=!0,this.textureSize=new f(1024,1024),this.rasterizeSceneCallback=(t,r)=>{this._renderer.render(t,r)},this.renderToCanvasCallback=(t,r,i)=>{const a=r.autoClear;r.autoClear=!1,i.render(r),r.autoClear=a},this.setScene(new X,new j)}setBVHWorker(e){this._generator.setBVHWorker(e)}setScene(e,t,r={}){e.updateMatrixWorld(!0),t.updateMatrixWorld();const i=this._generator;if(i.setObjects(e),this._buildAsync)return i.generateAsync(r.onProgress).then(a=>this._updateFromResults(e,t,a));{const a=i.generate();return this._updateFromResults(e,t,a)}}setSceneAsync(...e){this._buildAsync=!0;const t=this.setScene(...e);return this._buildAsync=!1,t}setCamera(e){this.camera=e,this.updateCamera()}updateCamera(){const e=this.camera;e.updateMatrixWorld(),this._pathTracer.setCamera(e),this._lowResPathTracer.setCamera(e),this.reset()}updateMaterials(){const e=this._pathTracer.material,t=this._renderer,r=this._materials,i=this.textureSize,a=Z(r);e.textures.setTextures(t,a,i.x,i.y),e.materials.updateFrom(r,a),this.reset()}updateLights(){const e=this.scene,t=this._renderer,r=this._pathTracer.material,i=J(e),a=K(i);r.lights.updateFrom(i,a),r.iesProfiles.setTextures(t,a),this.reset()}updateEnvironment(){const e=this.scene,t=this._pathTracer.material;if(this._internalBackground&&(this._internalBackground.dispose(),this._internalBackground=null),t.backgroundBlur=e.backgroundBlurriness,t.backgroundIntensity=e.backgroundIntensity??1,t.backgroundRotation.makeRotationFromEuler(e.backgroundRotation).invert(),e.background===null)t.backgroundMap=null,t.backgroundAlpha=0;else if(e.background.isColor){this._colorBackground=this._colorBackground||new ae(16);const r=this._colorBackground;r.topColor.equals(e.background)||(r.topColor.set(e.background),r.bottomColor.set(e.background),r.update()),t.backgroundMap=r,t.backgroundAlpha=1}else if(e.background.isCubeTexture){if(e.background!==this._previousBackground){const r=new F(this._renderer).generate(e.background);this._internalBackground=r,t.backgroundMap=r,t.backgroundAlpha=1}}else t.backgroundMap=e.background,t.backgroundAlpha=1;if(t.environmentIntensity=e.environment!==null?e.environmentIntensity??1:0,t.environmentRotation.makeRotationFromEuler(e.environmentRotation).invert(),this._previousEnvironment!==e.environment&&e.environment!==null)if(e.environment.isCubeTexture){const r=new F(this._renderer).generate(e.environment);t.envMapInfo.updateFrom(r)}else t.envMapInfo.updateFrom(e.environment);this._previousEnvironment=e.environment,this._previousBackground=e.background,this.reset()}_updateFromResults(e,t,r){const{materials:i,geometry:a,bvh:s,bvhChanged:n,needsMaterialIndexUpdate:l}=r;this._materials=i;const c=this._pathTracer.material;return n&&(c.bvh.updateFrom(s),c.attributesArray.updateFrom(a.attributes.normal,a.attributes.tangent,a.attributes.uv,a.attributes.color)),l&&c.materialIndexAttribute.updateFrom(a.attributes.materialIndex),this._previousScene=e,this.scene=e,this.camera=t,this.updateCamera(),this.updateMaterials(),this.updateEnvironment(),this.updateLights(),r}renderSample(){const e=this._lowResPathTracer,t=this._pathTracer,r=this._renderer,i=this._clock,a=this._quad;this._updateScale(),this._queueReset&&(t.reset(),e.reset(),this._queueReset=!1,a.material.opacity=0,i.start());const s=i.getDelta()*1e3,n=i.getElapsedTime()*1e3;if(!this.pausePathTracing&&this.enablePathTracing&&this.renderDelay<=n&&!this.isCompiling&&t.update(),t.alpha=t.material.backgroundAlpha!==1||!se(r),e.alpha=t.alpha,this.renderToCanvas){const l=this._renderer,m=this.minSamples;if(n>=this.renderDelay&&this.samples>=this.minSamples&&(this.fadeDuration!==0?a.material.opacity=Math.min(a.material.opacity+s/this.fadeDuration,1):a.material.opacity=1),!this.enablePathTracing||this.samples<m||a.material.opacity<1){if(this.dynamicLowRes&&!this.isCompiling){e.samples<1&&(e.material=t.material,e.update());const c=a.material.opacity;a.material.opacity=1-a.material.opacity,a.material.map=e.target.texture,a.render(l),a.material.opacity=c}(!this.dynamicLowRes&&this.rasterizeScene||this.dynamicLowRes&&this.isCompiling)&&this.rasterizeSceneCallback(this.scene,this.camera)}this.enablePathTracing&&a.material.opacity>0&&(a.material.opacity<1&&(a.material.blending=this.dynamicLowRes?Y:$),a.material.map=t.target.texture,this.renderToCanvasCallback(t.target,l,a),a.material.blending=C)}}reset(){this._queueReset=!0,this._pathTracer.samples=0}dispose(){this._quad.dispose(),this._quad.material.dispose(),this._pathTracer.dispose()}_updateScale(){if(this.synchronizeRenderSize){this._renderer.getDrawingBufferSize(h);const e=Math.floor(this.renderScale*h.x),t=Math.floor(this.renderScale*h.y);if(this._pathTracer.getSize(h),h.x!==e||h.y!==t){const r=this.lowResScale;this._pathTracer.setSize(e,t),this._lowResPathTracer.setSize(Math.floor(e*r),Math.floor(t*r))}}}}export{ae as G,ue as W};
