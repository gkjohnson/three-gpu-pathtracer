let e,t,a,r,o,i,n,s;function l(e,t,a,r){Object.defineProperty(e,t,{get:a,set:r,enumerable:!0,configurable:!0})}var c=globalThis,d={},h={},m=c.parcelRequire5b70;null==m&&((m=function(e){if(e in d)return d[e].exports;if(e in h){var t=h[e];delete h[e];var a={id:e,exports:{}};return d[e]=a,t.call(a.exports,a,a.exports),a.exports}var r=Error("Cannot find module '"+e+"'");throw r.code="MODULE_NOT_FOUND",r}).register=function(e,t){h[e]=t},c.parcelRequire5b70=m);var u=m.register;u("9fZ6X",function(e,t){l(e.exports,"MaterialBase",()=>r);var a=m("ilwiq");class r extends a.ShaderMaterial{set needsUpdate(e){super.needsUpdate=!0,this.dispatchEvent({type:"recompilation"})}constructor(e){for(let t in super(e),this.uniforms)Object.defineProperty(this,t,{get(){return this.uniforms[t].value},set(e){this.uniforms[t].value=e}})}setDefine(e,t){if(null==t){if(e in this.defines)return delete this.defines[e],this.needsUpdate=!0,!0}else if(this.defines[e]!==t)return this.defines[e]=t,this.needsUpdate=!0,!0;return!1}}}),u("e2Pv4",function(e,t){let a;l(e.exports,"LoaderElement",()=>r);class r{constructor(){a||((a=document.createElement("style")).textContent=`

		.loader-container, .description {
			position: absolute;
			width: 100%;
			font-family: 'Courier New', Courier, monospace;
			color: white;
			font-weight: light;
			align-items: flex-start;
			font-size: 14px;
			pointer-events: none;
			user-select: none;
		}

		.loader-container {
			display: flex;
			flex-direction: column;
			bottom: 0;
		}

		.description {
			top: 0;
			width: 100%;
			text-align: center;
			padding: 5px 0;
		}

		.loader-container .bar {
			height: 2px;
			background: white;
			width: 100%;
		}

		.loader-container .credits,
		.loader-container .samples,
		.loader-container .percentage {
			padding: 5px;
			margin: 0 0 1px 1px;
			background: rgba( 0, 0, 0, 0.2 );
			border-radius: 2px;
			display: inline-block;
		}

		.loader-container:not(.loading) .bar,
		.loader-container:not(.loading) .percentage,
		.loader-container.loading .credits,
		.loader-container.loading .samples,
		.loader-container .credits:empty {
			display: none;
		}

		.loader-container .credits a,
		.loader-container .credits,
		.loader-container .samples {
			color: rgba( 255, 255, 255, 0.75 );
		}
	`,document.head.appendChild(a));let e=document.createElement("div");e.classList.add("loader-container");let t=document.createElement("div");t.classList.add("percentage"),e.appendChild(t);let r=document.createElement("div");r.classList.add("samples"),e.appendChild(r);let o=document.createElement("div");o.classList.add("credits"),e.appendChild(o);let i=document.createElement("div");i.classList.add("bar"),e.appendChild(i);let n=document.createElement("div");n.classList.add("description"),e.appendChild(n),this._description=n,this._loaderBar=i,this._percentage=t,this._credits=o,this._samples=r,this._container=e,this.setPercentage(0)}attach(e){e.appendChild(this._container),e.appendChild(this._description)}setPercentage(e){this._loaderBar.style.width=`${100*e}%`,0===e?this._percentage.innerText="Loading...":this._percentage.innerText=`${(100*e).toFixed(0)}%`,e>=1?this._container.classList.remove("loading"):this._container.classList.add("loading")}setSamples(e,t=!1){t?this._samples.innerText="compiling shader...":this._samples.innerText=`${Math.floor(e)} samples`}setCredits(e){this._credits.innerHTML=e}setDescription(e){this._description.innerHTML=e}}}),u("fYvb1",function(e,t){l(e.exports,"math_functions",()=>a);let a=`

	// Fast arccos approximation used to remove banding artifacts caused by numerical errors in acos.
	// This is a cubic Lagrange interpolating polynomial for x = [-1, -1/2, 0, 1/2, 1].
	// For more information see: https://github.com/gkjohnson/three-gpu-pathtracer/pull/171#issuecomment-1152275248
	float acosApprox( float x ) {

		x = clamp( x, -1.0, 1.0 );
		return ( - 0.69813170079773212 * x * x - 0.87266462599716477 ) * x + 1.5707963267948966;

	}

	// An acos with input values bound to the range [-1, 1].
	float acosSafe( float x ) {

		return acos( clamp( x, -1.0, 1.0 ) );

	}

	float saturateCos( float val ) {

		return clamp( val, 0.001, 1.0 );

	}

	float square( float t ) {

		return t * t;

	}

	vec2 square( vec2 t ) {

		return t * t;

	}

	vec3 square( vec3 t ) {

		return t * t;

	}

	vec4 square( vec4 t ) {

		return t * t;

	}

	vec2 rotateVector( vec2 v, float t ) {

		float ac = cos( t );
		float as = sin( t );
		return vec2(
			v.x * ac - v.y * as,
			v.x * as + v.y * ac
		);

	}

	// forms a basis with the normal vector as Z
	mat3 getBasisFromNormal( vec3 normal ) {

		vec3 other;
		if ( abs( normal.x ) > 0.5 ) {

			other = vec3( 0.0, 1.0, 0.0 );

		} else {

			other = vec3( 1.0, 0.0, 0.0 );

		}

		vec3 ortho = normalize( cross( normal, other ) );
		vec3 ortho2 = normalize( cross( normal, ortho ) );
		return mat3( ortho2, ortho, normal );

	}

`}),u("dUUQZ",function(e,t){l(e.exports,"util_functions",()=>a);let a=`

	// TODO: possibly this should be renamed something related to material or path tracing logic

	#ifndef RAY_OFFSET
	#define RAY_OFFSET 1e-4
	#endif

	// adjust the hit point by the surface normal by a factor of some offset and the
	// maximum component-wise value of the current point to accommodate floating point
	// error as values increase.
	vec3 stepRayOrigin( vec3 rayOrigin, vec3 rayDirection, vec3 offset, float dist ) {

		vec3 point = rayOrigin + rayDirection * dist;
		vec3 absPoint = abs( point );
		float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
		return point + offset * ( maxPoint + 1.0 ) * RAY_OFFSET;

	}

	// https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_volume/README.md#attenuation
	vec3 transmissionAttenuation( float dist, vec3 attColor, float attDist ) {

		vec3 ot = - log( attColor ) / attDist;
		return exp( - ot * dist );

	}

	vec3 getHalfVector( vec3 wi, vec3 wo, float eta ) {

		// get the half vector - assuming if the light incident vector is on the other side
		// of the that it's transmissive.
		vec3 h;
		if ( wi.z > 0.0 ) {

			h = normalize( wi + wo );

		} else {

			// Scale by the ior ratio to retrieve the appropriate half vector
			// From Section 2.2 on computing the transmission half vector:
			// https://blog.selfshadow.com/publications/s2015-shading-course/burley/s2015_pbs_disney_bsdf_notes.pdf
			h = normalize( wi + wo * eta );

		}

		h *= sign( h.z );
		return h;

	}

	vec3 getHalfVector( vec3 a, vec3 b ) {

		return normalize( a + b );

	}

	// The discrepancy between interpolated surface normal and geometry normal can cause issues when a ray
	// is cast that is on the top side of the geometry normal plane but below the surface normal plane. If
	// we find a ray like that we ignore it to avoid artifacts.
	// This function returns if the direction is on the same side of both planes.
	bool isDirectionValid( vec3 direction, vec3 surfaceNormal, vec3 geometryNormal ) {

		bool aboveSurfaceNormal = dot( direction, surfaceNormal ) > 0.0;
		bool aboveGeometryNormal = dot( direction, geometryNormal ) > 0.0;
		return aboveSurfaceNormal == aboveGeometryNormal;

	}

	// ray sampling x and z are swapped to align with expected background view
	vec2 equirectDirectionToUv( vec3 direction ) {

		// from Spherical.setFromCartesianCoords
		vec2 uv = vec2( atan( direction.z, direction.x ), acos( direction.y ) );
		uv /= vec2( 2.0 * PI, PI );

		// apply adjustments to get values in range [0, 1] and y right side up
		uv.x += 0.5;
		uv.y = 1.0 - uv.y;
		return uv;

	}

	vec3 equirectUvToDirection( vec2 uv ) {

		// undo above adjustments
		uv.x -= 0.5;
		uv.y = 1.0 - uv.y;

		// from Vector3.setFromSphericalCoords
		float theta = uv.x * 2.0 * PI;
		float phi = uv.y * PI;

		float sinPhi = sin( phi );

		return vec3( sinPhi * cos( theta ), cos( phi ), sinPhi * sin( theta ) );

	}

	// power heuristic for multiple importance sampling
	float misHeuristic( float a, float b ) {

		float aa = a * a;
		float bb = b * b;
		return aa / ( aa + bb );

	}

	// tentFilter from Peter Shirley's 'Realistic Ray Tracing (2nd Edition)' book, pg. 60
	// erichlof/THREE.js-PathTracing-Renderer/
	float tentFilter( float x ) {

		return x < 0.5 ? sqrt( 2.0 * x ) - 1.0 : 1.0 - sqrt( 2.0 - ( 2.0 * x ) );

	}
`}),u("8keuf",function(e,t){l(e.exports,"ggx_functions",()=>a);let a=`

	// The GGX functions provide sampling and distribution information for normals as output so
	// in order to get probability of scatter direction the half vector must be computed and provided.
	// [0] https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf
	// [1] https://hal.archives-ouvertes.fr/hal-01509746/document
	// [2] http://jcgt.org/published/0007/04/01/
	// [4] http://jcgt.org/published/0003/02/03/

	// trowbridge-reitz === GGX === GTR

	vec3 ggxDirection( vec3 incidentDir, vec2 roughness, vec2 uv ) {

		// TODO: try GGXVNDF implementation from reference [2], here. Needs to update ggxDistribution
		// function below, as well

		// Implementation from reference [1]
		// stretch view
		vec3 V = normalize( vec3( roughness * incidentDir.xy, incidentDir.z ) );

		// orthonormal basis
		vec3 T1 = ( V.z < 0.9999 ) ? normalize( cross( V, vec3( 0.0, 0.0, 1.0 ) ) ) : vec3( 1.0, 0.0, 0.0 );
		vec3 T2 = cross( T1, V );

		// sample point with polar coordinates (r, phi)
		float a = 1.0 / ( 1.0 + V.z );
		float r = sqrt( uv.x );
		float phi = ( uv.y < a ) ? uv.y / a * PI : PI + ( uv.y - a ) / ( 1.0 - a ) * PI;
		float P1 = r * cos( phi );
		float P2 = r * sin( phi ) * ( ( uv.y < a ) ? 1.0 : V.z );

		// compute normal
		vec3 N = P1 * T1 + P2 * T2 + V * sqrt( max( 0.0, 1.0 - P1 * P1 - P2 * P2 ) );

		// unstretch
		N = normalize( vec3( roughness * N.xy, max( 0.0, N.z ) ) );

		return N;

	}

	// Below are PDF and related functions for use in a Monte Carlo path tracer
	// as specified in Appendix B of the following paper
	// See equation (34) from reference [0]
	float ggxLamda( float theta, float roughness ) {

		float tanTheta = tan( theta );
		float tanTheta2 = tanTheta * tanTheta;
		float alpha2 = roughness * roughness;

		float numerator = - 1.0 + sqrt( 1.0 + alpha2 * tanTheta2 );
		return numerator / 2.0;

	}

	// See equation (34) from reference [0]
	float ggxShadowMaskG1( float theta, float roughness ) {

		return 1.0 / ( 1.0 + ggxLamda( theta, roughness ) );

	}

	// See equation (125) from reference [4]
	float ggxShadowMaskG2( vec3 wi, vec3 wo, float roughness ) {

		float incidentTheta = acos( wi.z );
		float scatterTheta = acos( wo.z );
		return 1.0 / ( 1.0 + ggxLamda( incidentTheta, roughness ) + ggxLamda( scatterTheta, roughness ) );

	}

	// See equation (33) from reference [0]
	float ggxDistribution( vec3 halfVector, float roughness ) {

		float a2 = roughness * roughness;
		a2 = max( EPSILON, a2 );
		float cosTheta = halfVector.z;
		float cosTheta4 = pow( cosTheta, 4.0 );

		if ( cosTheta == 0.0 ) return 0.0;

		float theta = acosSafe( halfVector.z );
		float tanTheta = tan( theta );
		float tanTheta2 = pow( tanTheta, 2.0 );

		float denom = PI * cosTheta4 * pow( a2 + tanTheta2, 2.0 );
		return ( a2 / denom );

	}

	// See equation (3) from reference [2]
	float ggxPDF( vec3 wi, vec3 halfVector, float roughness ) {

		float incidentTheta = acos( wi.z );
		float D = ggxDistribution( halfVector, roughness );
		float G1 = ggxShadowMaskG1( incidentTheta, roughness );

		return D * G1 * max( 0.0, dot( wi, halfVector ) ) / wi.z;

	}

`});var p=m("ilwiq"),f=m("RPVlj"),g=m("5Rd1x"),p=m("ilwiq"),v=m("9fZ6X");class x extends v.MaterialBase{constructor(e){super({blending:p.NoBlending,transparent:!1,depthWrite:!1,depthTest:!1,defines:{USE_SLIDER:0},uniforms:{sigma:{value:5},threshold:{value:.03},kSigma:{value:1},map:{value:null},opacity:{value:1}},vertexShader:`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}

			`,fragmentShader:`

				//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
				//  Copyright (c) 2018-2019 Michele Morrone
				//  All rights reserved.
				//
				//  https://michelemorrone.eu - https://BrutPitt.com
				//
				//  me@michelemorrone.eu - brutpitt@gmail.com
				//  twitter: @BrutPitt - github: BrutPitt
				//
				//  https://github.com/BrutPitt/glslSmartDeNoise/
				//
				//  This software is distributed under the terms of the BSD 2-Clause license
				//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

				uniform sampler2D map;

				uniform float sigma;
				uniform float threshold;
				uniform float kSigma;
				uniform float opacity;

				varying vec2 vUv;

				#define INV_SQRT_OF_2PI 0.39894228040143267793994605993439
				#define INV_PI 0.31830988618379067153776752674503

				// Parameters:
				//	 sampler2D tex	 - sampler image / texture
				//	 vec2 uv		   - actual fragment coord
				//	 float sigma  >  0 - sigma Standard Deviation
				//	 float kSigma >= 0 - sigma coefficient
				//		 kSigma * sigma  -->  radius of the circular kernel
				//	 float threshold   - edge sharpening threshold
				vec4 smartDeNoise( sampler2D tex, vec2 uv, float sigma, float kSigma, float threshold ) {

					float radius = round( kSigma * sigma );
					float radQ = radius * radius;

					float invSigmaQx2 = 0.5 / ( sigma * sigma );
					float invSigmaQx2PI = INV_PI * invSigmaQx2;

					float invThresholdSqx2 = 0.5 / ( threshold * threshold );
					float invThresholdSqrt2PI = INV_SQRT_OF_2PI / threshold;

					vec4 centrPx = texture2D( tex, uv );
					centrPx.rgb *= centrPx.a;

					float zBuff = 0.0;
					vec4 aBuff = vec4( 0.0 );
					vec2 size = vec2( textureSize( tex, 0 ) );

					vec2 d;
					for ( d.x = - radius; d.x <= radius; d.x ++ ) {

						float pt = sqrt( radQ - d.x * d.x );

						for ( d.y = - pt; d.y <= pt; d.y ++ ) {

							float blurFactor = exp( - dot( d, d ) * invSigmaQx2 ) * invSigmaQx2PI;

							vec4 walkPx = texture2D( tex, uv + d / size );
							walkPx.rgb *= walkPx.a;

							vec4 dC = walkPx - centrPx;
							float deltaFactor = exp( - dot( dC.rgba, dC.rgba ) * invThresholdSqx2 ) * invThresholdSqrt2PI * blurFactor;

							zBuff += deltaFactor;
							aBuff += deltaFactor * walkPx;

						}

					}

					return aBuff / zBuff;

				}

				void main() {

					gl_FragColor = smartDeNoise( map, vec2( vUv.x, vUv.y ), sigma, kSigma, threshold );
					#include <tonemapping_fragment>
					#include <colorspace_fragment>
					#include <premultiplied_alpha_fragment>

					gl_FragColor.a *= opacity;

				}

			`}),this.setValues(e)}}var b=m("8mHfG"),P=m("jiuw3"),w=m("e2Pv4"),y=m("jiJLv"),C=m("lhJUT");const S={materialProperties:{color:"#ffe6bd",emissive:"#000000",emissiveIntensity:1,roughness:0,metalness:1,ior:1.495,transmission:0,thinFilm:!1,attenuationColor:"#ffffff",attenuationDistance:.5,opacity:1,clearcoat:0,clearcoatRoughness:0,sheenColor:"#000000",sheenRoughness:0,iridescence:0,iridescenceIOR:1.5,iridescenceThickness:400,specularColor:"#ffffff",specularIntensity:1,matte:!1,flatShading:!1,castShadow:!0},multipleImportanceSampling:!0,denoiseEnabled:!0,denoiseSigma:2.5,denoiseThreshold:.1,denoiseKSigma:1,bounces:5,renderScale:1/window.devicePixelRatio,transmissiveBounces:20,filterGlossyFactor:.5,tiles:3};async function T(){(0,C.RectAreaLightUniformsLib).init(),(s=new w.LoaderElement).attach(document.body),(t=new p.WebGLRenderer({antialias:!0})).toneMapping=p.ACESFilmicToneMapping,t.toneMappingExposure=.02,document.body.appendChild(t.domElement),(e=new b.WebGLPathTracer(t)).tiles.set(S.tiles,S.tiles),e.textureSize.set(2048,2048),e.renderToCanvasCallback=(e,t,a)=>{r.material.sigma=S.denoiseSigma,r.material.threshold=S.denoiseThreshold,r.material.kSigma=S.denoiseKSigma,r.material.opacity=a.material.opacity;let o=t.autoClear,i=S.denoiseEnabled?r:a;t.autoClear=!1,i.material.map=e.texture,i.render(t),t.autoClear=o},r=new f.FullScreenQuad(new x({map:null,blending:p.CustomBlending,premultipliedAlpha:t.getContextAttributes().premultipliedAlpha})),n=new p.Scene,window.SCENE=n;let l=await new(0,y.MaterialOrbSceneLoader)().loadAsync();n.add(l.scene),i=l.camera,o=l.material,n.attach(i),i.removeFromParent(),(a=new g.OrbitControls(i,t.domElement)).addEventListener("change",()=>e.updateCamera());let c=new(0,p.Vector3)(0,0,-1).transformDirection(i.matrixWorld).normalize();a.target.copy(i.position).addScaledVector(c,25),a.update(),s.setPercentage(1),s.setCredits("Material orb model courtesy of USD Working Group"),D(),_(),window.addEventListener("resize",_);let d=new P.GUI,h=d.addFolder("Path Tracer");h.add(S,"multipleImportanceSampling").onChange(D),h.add(S,"tiles",1,4,1).onChange(t=>{e.tiles.set(t,t)}),h.add(S,"filterGlossyFactor",0,1).onChange(D),h.add(S,"bounces",1,30,1).onChange(D),h.add(S,"transmissiveBounces",0,40,1).onChange(D),h.add(S,"renderScale",.1,1).onChange(D);let m=d.addFolder("Denoising");m.add(S,"denoiseEnabled"),m.add(S,"denoiseSigma",.01,12),m.add(S,"denoiseThreshold",.01,1),m.add(S,"denoiseKSigma",0,12),m.close();let u=d.addFolder("Material");u.addColor(S.materialProperties,"color").onChange(D),u.addColor(S.materialProperties,"emissive").onChange(D),u.add(S.materialProperties,"emissiveIntensity",0,50,.01).onChange(D),u.add(S.materialProperties,"roughness",0,1).onChange(D),u.add(S.materialProperties,"metalness",0,1).onChange(D),u.add(S.materialProperties,"opacity",0,1).onChange(D),u.add(S.materialProperties,"transmission",0,1).onChange(D),u.add(S.materialProperties,"thinFilm",0,1).onChange(D),u.add(S.materialProperties,"attenuationDistance",.05,2).onChange(D),u.addColor(S.materialProperties,"attenuationColor").onChange(D),u.add(S.materialProperties,"ior",.9,3).onChange(D),u.add(S.materialProperties,"clearcoat",0,1).onChange(D),u.add(S.materialProperties,"clearcoatRoughness",0,1).onChange(D),u.addColor(S.materialProperties,"sheenColor").onChange(D),u.add(S.materialProperties,"sheenRoughness",0,1).onChange(D),u.add(S.materialProperties,"iridescence",0,1).onChange(D),u.add(S.materialProperties,"iridescenceIOR",.1,3).onChange(D),u.add(S.materialProperties,"iridescenceThickness",0,1200).onChange(D),u.addColor(S.materialProperties,"specularColor").onChange(D),u.add(S.materialProperties,"specularIntensity",0,1).onChange(D),u.add(S.materialProperties,"matte").onChange(D),u.add(S.materialProperties,"flatShading").onChange(D),u.add(S.materialProperties,"castShadow").onChange(D),u.close(),function t(){requestAnimationFrame(t),e.renderSample(),s.setSamples(e.samples,e.isCompiling)}()}function _(){t.setSize(window.innerWidth,window.innerHeight),t.setPixelRatio(window.devicePixelRatio),i.aspect=window.innerWidth/window.innerHeight,i.updateProjectionMatrix(),e.updateCamera()}function D(){let t=S.materialProperties;o.color.set(t.color),o.emissive.set(t.emissive),o.emissiveIntensity=t.emissiveIntensity,o.metalness=t.metalness,o.roughness=t.roughness,o.transmission=t.transmission,o.attenuationDistance=t.thinFilm?1/0:t.attenuationDistance,o.attenuationColor.set(t.attenuationColor),o.ior=t.ior,o.opacity=t.opacity,o.clearcoat=t.clearcoat,o.clearcoatRoughness=t.clearcoatRoughness,o.sheenColor.set(t.sheenColor),o.sheenRoughness=t.sheenRoughness,o.iridescence=t.iridescence,o.iridescenceIOR=t.iridescenceIOR,o.iridescenceThicknessRange=[0,t.iridescenceThickness],o.specularColor.set(t.specularColor),o.specularIntensity=t.specularIntensity,o.transparent=o.opacity<1,o.flatShading=t.flatShading,e.transmissiveBounces=S.transmissiveBounces,e.multipleImportanceSampling=S.multipleImportanceSampling,e.filterGlossyFactor=S.filterGlossyFactor,e.bounces=S.bounces,e.renderScale=S.renderScale,o.matte=t.matte,o.castShadow=t.castShadow,e.updateMaterials(),e.setScene(n,i)}window.location.hash.includes("transmission")?(S.materialProperties.metalness=0,S.materialProperties.roughness=.23,S.materialProperties.transmission=1,S.materialProperties.color="#ffffff",S.bounces=10,S.tiles=2):window.location.hash.includes("iridescent")?(S.materialProperties.color="#474747",S.materialProperties.roughness=.25,S.materialProperties.metalness=1,S.materialProperties.iridescence=1,S.materialProperties.iridescenceIOR=2.2):window.location.hash.includes("acrylic")&&(S.materialProperties.color="#ffffff",S.materialProperties.roughness=0,S.materialProperties.metalness=0,S.materialProperties.transmission=1,S.materialProperties.attenuationDistance=.75,S.materialProperties.attenuationColor="#2a6dc6",S.bounces=20,S.tiles=3),window.innerWidth/window.innerHeight<.65&&(S.bounces=Math.max(S.bounces,6),S.renderScale*=.5,S.tiles=2,S.multipleImportanceSampling=!1),T();
//# sourceMappingURL=materialBall.2d30a0c5.js.map
