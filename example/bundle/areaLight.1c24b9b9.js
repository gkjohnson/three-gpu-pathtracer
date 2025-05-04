function e(e,t,r,a){Object.defineProperty(e,t,{get:r,set:a,enumerable:!0,configurable:!0})}var t=globalThis,r={},a={},i=t.parcelRequire5b70;null==i&&((i=function(e){if(e in r)return r[e].exports;if(e in a){var t=a[e];delete a[e];var i={id:e,exports:{}};return r[e]=i,t.call(i.exports,i,i.exports),i.exports}var n=Error("Cannot find module '"+e+"'");throw n.code="MODULE_NOT_FOUND",n}).register=function(e,t){a[e]=t},t.parcelRequire5b70=i);var n=i.register;n("8mHfG",function(t,r){e(t.exports,"WebGLPathTracer",()=>d);var a=i("ilwiq"),n=i("hWj76"),s=i("hWds8"),l=i("RPVlj"),o=i("bHiTZ"),c=i("9wqOU"),p=i("5rCKZ"),u=i("5VY8i");let h=new a.Vector2;class d{get multipleImportanceSampling(){return!!this._pathTracer.material.defines.FEATURE_MIS}set multipleImportanceSampling(e){this._pathTracer.material.setDefine("FEATURE_MIS",e?1:0)}get transmissiveBounces(){return this._pathTracer.material.transmissiveBounces}set transmissiveBounces(e){this._pathTracer.material.transmissiveBounces=e}get bounces(){return this._pathTracer.material.bounces}set bounces(e){this._pathTracer.material.bounces=e}get filterGlossyFactor(){return this._pathTracer.material.filterGlossyFactor}set filterGlossyFactor(e){this._pathTracer.material.filterGlossyFactor=e}get samples(){return this._pathTracer.samples}get target(){return this._pathTracer.target}get tiles(){return this._pathTracer.tiles}get stableNoise(){return this._pathTracer.stableNoise}set stableNoise(e){this._pathTracer.stableNoise=e}get isCompiling(){return!!this._pathTracer.isCompiling}constructor(e){this._renderer=e,this._generator=new n.PathTracingSceneGenerator,this._pathTracer=new s.PathTracingRenderer(e),this._queueReset=!1,this._clock=new a.Clock,this._compilePromise=null,this._lowResPathTracer=new s.PathTracingRenderer(e),this._lowResPathTracer.tiles.set(1,1),this._quad=new l.FullScreenQuad(new p.ClampedInterpolationMaterial({map:null,transparent:!0,blending:a.NoBlending,premultipliedAlpha:e.getContextAttributes().premultipliedAlpha})),this._materials=null,this._previousEnvironment=null,this._previousBackground=null,this._internalBackground=null,this.renderDelay=100,this.minSamples=5,this.fadeDuration=500,this.enablePathTracing=!0,this.pausePathTracing=!1,this.dynamicLowRes=!1,this.lowResScale=.25,this.renderScale=1,this.synchronizeRenderSize=!0,this.rasterizeScene=!0,this.renderToCanvas=!0,this.textureSize=new a.Vector2(1024,1024),this.rasterizeSceneCallback=(e,t)=>{this._renderer.render(e,t)},this.renderToCanvasCallback=(e,t,r)=>{let a=t.autoClear;t.autoClear=!1,r.render(t),t.autoClear=a},this.setScene(new a.Scene,new a.PerspectiveCamera)}setBVHWorker(e){this._generator.setBVHWorker(e)}setScene(e,t,r={}){e.updateMatrixWorld(!0),t.updateMatrixWorld();let a=this._generator;if(a.setObjects(e),this._buildAsync)return a.generateAsync(r.onProgress).then(r=>this._updateFromResults(e,t,r));{let r=a.generate();return this._updateFromResults(e,t,r)}}setSceneAsync(...e){this._buildAsync=!0;let t=this.setScene(...e);return this._buildAsync=!1,t}setCamera(e){this.camera=e,this.updateCamera()}updateCamera(){let e=this.camera;e.updateMatrixWorld(),this._pathTracer.setCamera(e),this._lowResPathTracer.setCamera(e),this.reset()}updateMaterials(){let e=this._pathTracer.material,t=this._renderer,r=this._materials,a=this.textureSize,i=(0,c.getTextures)(r);e.textures.setTextures(t,i,a.x,a.y),e.materials.updateFrom(r,i),this.reset()}updateLights(){let e=this.scene,t=this._renderer,r=this._pathTracer.material,a=(0,c.getLights)(e),i=(0,c.getIesTextures)(a);r.lights.updateFrom(a,i),r.iesProfiles.setTextures(t,i),this.reset()}updateEnvironment(){let e=this.scene,t=this._pathTracer.material;if(this._internalBackground&&(this._internalBackground.dispose(),this._internalBackground=null),t.backgroundBlur=e.backgroundBlurriness,t.backgroundIntensity=e.backgroundIntensity??1,t.backgroundRotation.makeRotationFromEuler(e.backgroundRotation).invert(),null===e.background)t.backgroundMap=null,t.backgroundAlpha=0;else if(e.background.isColor){this._colorBackground=this._colorBackground||new o.GradientEquirectTexture(16);let r=this._colorBackground;r.topColor.equals(e.background)||(r.topColor.set(e.background),r.bottomColor.set(e.background),r.update()),t.backgroundMap=r,t.backgroundAlpha=1}else if(e.background.isCubeTexture){if(e.background!==this._previousBackground){let r=new(0,u.CubeToEquirectGenerator)(this._renderer).generate(e.background);this._internalBackground=r,t.backgroundMap=r,t.backgroundAlpha=1}}else t.backgroundMap=e.background,t.backgroundAlpha=1;if(t.environmentIntensity=null!==e.environment?e.environmentIntensity??1:0,t.environmentRotation.makeRotationFromEuler(e.environmentRotation).invert(),this._previousEnvironment!==e.environment&&null!==e.environment){if(e.environment.isCubeTexture){let r=new(0,u.CubeToEquirectGenerator)(this._renderer).generate(e.environment);t.envMapInfo.updateFrom(r)}else t.envMapInfo.updateFrom(e.environment)}this._previousEnvironment=e.environment,this._previousBackground=e.background,this.reset()}_updateFromResults(e,t,r){let{materials:a,geometry:i,bvh:n,bvhChanged:s,needsMaterialIndexUpdate:l}=r;this._materials=a;let o=this._pathTracer.material;return s&&(o.bvh.updateFrom(n),o.attributesArray.updateFrom(i.attributes.normal,i.attributes.tangent,i.attributes.uv,i.attributes.color)),l&&o.materialIndexAttribute.updateFrom(i.attributes.materialIndex),this._previousScene=e,this.scene=e,this.camera=t,this.updateCamera(),this.updateMaterials(),this.updateEnvironment(),this.updateLights(),r}renderSample(){let e=this._lowResPathTracer,t=this._pathTracer,r=this._renderer,i=this._clock,n=this._quad;this._updateScale(),this._queueReset&&(t.reset(),e.reset(),this._queueReset=!1,n.material.opacity=0,i.start());let s=1e3*i.getDelta(),l=1e3*i.getElapsedTime();if(!this.pausePathTracing&&this.enablePathTracing&&this.renderDelay<=l&&!this.isCompiling&&t.update(),t.alpha=1!==t.material.backgroundAlpha||!r.extensions.get("EXT_float_blend"),e.alpha=t.alpha,this.renderToCanvas){let r=this._renderer,i=this.minSamples;if(l>=this.renderDelay&&this.samples>=this.minSamples&&(0!==this.fadeDuration?n.material.opacity=Math.min(n.material.opacity+s/this.fadeDuration,1):n.material.opacity=1),!this.enablePathTracing||this.samples<i||n.material.opacity<1){if(this.dynamicLowRes&&!this.isCompiling){e.samples<1&&(e.material=t.material,e.update());let a=n.material.opacity;n.material.opacity=1-n.material.opacity,n.material.map=e.target.texture,n.render(r),n.material.opacity=a}(!this.dynamicLowRes&&this.rasterizeScene||this.dynamicLowRes&&this.isCompiling)&&this.rasterizeSceneCallback(this.scene,this.camera)}this.enablePathTracing&&n.material.opacity>0&&(n.material.opacity<1&&(n.material.blending=this.dynamicLowRes?a.AdditiveBlending:a.NormalBlending),n.material.map=t.target.texture,this.renderToCanvasCallback(t.target,r,n),n.material.blending=a.NoBlending)}}reset(){this._queueReset=!0,this._pathTracer.samples=0}dispose(){this._quad.dispose(),this._quad.material.dispose(),this._pathTracer.dispose()}_updateScale(){if(this.synchronizeRenderSize){this._renderer.getDrawingBufferSize(h);let e=Math.floor(this.renderScale*h.x),t=Math.floor(this.renderScale*h.y);if(this._pathTracer.getSize(h),h.x!==e||h.y!==t){let r=this.lowResScale;this._pathTracer.setSize(e,t),this._lowResPathTracer.setSize(Math.floor(e*r),Math.floor(t*r))}}}}}),n("bHiTZ",function(t,r){e(t.exports,"GradientEquirectTexture",()=>l);var a=i("ilwiq"),n=i("dbdMq");let s=new a.Vector3;class l extends n.ProceduralEquirectTexture{constructor(e=512){super(e,e),this.topColor=new(0,a.Color)().set(16777215),this.bottomColor=new(0,a.Color)().set(0),this.exponent=2,this.generationCallback=(e,t,r,a)=>{s.setFromSpherical(e);let i=.5*s.y+.5;a.lerpColors(this.bottomColor,this.topColor,i**this.exponent)}}copy(e){return super.copy(e),this.topColor.copy(e.topColor),this.bottomColor.copy(e.bottomColor),this}}}),n("dbdMq",function(t,r){e(t.exports,"ProceduralEquirectTexture",()=>c);var a=i("ilwiq");let n=new a.Vector2,s=new a.Vector2,l=new a.Spherical,o=new a.Color;class c extends a.DataTexture{constructor(e=512,t=512){super(new Float32Array(e*t*4),e,t,a.RGBAFormat,a.FloatType,a.EquirectangularReflectionMapping,a.RepeatWrapping,a.ClampToEdgeWrapping,a.LinearFilter,a.LinearFilter),this.generationCallback=null}update(){this.dispose(),this.needsUpdate=!0;let{data:e,width:t,height:r}=this.image;for(let a=0;a<t;a++)for(let i=0;i<r;i++){s.set(t,r),n.set(a/t,i/r),n.x-=.5,n.y=1-n.y,l.theta=2*n.x*Math.PI,l.phi=n.y*Math.PI,l.radius=1,this.generationCallback(l,n,s,o);let c=4*(i*t+a);e[c+0]=o.r,e[c+1]=o.g,e[c+2]=o.b,e[c+3]=1}}copy(e){return super.copy(e),this.generationCallback=e.generationCallback,this}}}),n("5rCKZ",function(t,r){e(t.exports,"ClampedInterpolationMaterial",()=>n);var a=i("ilwiq");class n extends a.ShaderMaterial{get map(){return this.uniforms.map.value}set map(e){this.uniforms.map.value=e}get opacity(){return this.uniforms.opacity.value}set opacity(e){this.uniforms&&(this.uniforms.opacity.value=e)}constructor(e){super({uniforms:{map:{value:null},opacity:{value:1}},vertexShader:`
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
			`}),this.setValues(e)}}}),n("5VY8i",function(t,r){e(t.exports,"CubeToEquirectGenerator",()=>o);var a=i("ilwiq"),n=i("RPVlj"),s=i("dUUQZ");class l extends a.ShaderMaterial{constructor(){super({uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:`
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

				${s.util_functions}

				void main() {

					vec3 rayDirection = equirectUvToDirection( vUv );
					rayDirection.x *= flipEnvMap;
					gl_FragColor = textureCube( envMap, rayDirection );

				}`}),this.depthWrite=!1,this.depthTest=!1}}class o{constructor(e){this._renderer=e,this._quad=new n.FullScreenQuad(new l)}generate(e,t=null,r=null){if(!e.isCubeTexture)throw Error("CubeToEquirectMaterial: Source can only be cube textures.");let i=e.images[0],n=this._renderer,s=this._quad;null===t&&(t=4*i.height),null===r&&(r=2*i.height);let l=new a.WebGLRenderTarget(t,r,{type:a.FloatType,colorSpace:i.colorSpace}),o=i.height,c=Math.log2(o)-2;s.material.defines.CUBEUV_MAX_MIP=`${c}.0`,s.material.defines.CUBEUV_TEXEL_WIDTH=1/(3*Math.max(Math.pow(2,c),112)),s.material.defines.CUBEUV_TEXEL_HEIGHT=1/o,s.material.uniforms.envMap.value=e,s.material.uniforms.flipEnvMap.value=e.isRenderTargetTexture?1:-1,s.material.needsUpdate=!0;let p=n.getRenderTarget(),u=n.autoClear;n.autoClear=!0,n.setRenderTarget(l),s.render(n),n.setRenderTarget(p),n.autoClear=u;let h=new Uint16Array(t*r*4),d=new Float32Array(t*r*4);n.readRenderTargetPixels(l,0,0,t,r,d),l.dispose();for(let e=0,t=d.length;e<t;e++)h[e]=(0,a.DataUtils).toHalfFloat(d[e]);let m=new a.DataTexture(h,t,r,a.RGBAFormat,a.HalfFloatType);return m.minFilter=a.LinearMipMapLinearFilter,m.magFilter=a.LinearFilter,m.wrapS=a.RepeatWrapping,m.wrapT=a.RepeatWrapping,m.mapping=a.EquirectangularReflectionMapping,m.needsUpdate=!0,m}dispose(){this._quad.dispose()}}});
//# sourceMappingURL=areaLight.1c24b9b9.js.map
