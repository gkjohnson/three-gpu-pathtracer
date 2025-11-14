import"./modulepreload-polyfill-B5Qt9EMX.js";import{b as y,aP as b,at as I,au as F,aR as R,av as D,m as T}from"./MaterialBase-byhyp4gt.js";import{F as k}from"./pcg.glsl-Dh-2-BlJ.js";import{O as B}from"./OrbitControls-BDTesZS8.js";import{g as M}from"./lil-gui.module.min-BH_YJbPT.js";import{L as _}from"./LoaderElement-kg8-0xPv.js";import{R as E,M as Q}from"./RectAreaLightUniformsLib-CJR3JT3H.js";import{W as z}from"./WebGLPathTracer-DzRjmE4y.js";import"./GLTFLoader-BYq4k_JA.js";import"./BufferGeometryUtils-DMgFFDwZ.js";import"./PathTracingRenderer-N-9Lxrjr.js";import"./ggx_functions.glsl-BPuHaSoe.js";class L extends y{constructor(f){super({blending:b,transparent:!1,depthWrite:!1,depthTest:!1,defines:{USE_SLIDER:0},uniforms:{sigma:{value:5},threshold:{value:.03},kSigma:{value:1},map:{value:null},opacity:{value:1}},vertexShader:`

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

			`}),this.setValues(f)}}const O="Material orb model courtesy of USD Working Group";let o,n,g,d,i,s,c,p;const e={materialProperties:{color:"#ffe6bd",emissive:"#000000",emissiveIntensity:1,roughness:0,metalness:1,ior:1.495,transmission:0,thinFilm:!1,attenuationColor:"#ffffff",attenuationDistance:.5,opacity:1,clearcoat:0,clearcoatRoughness:0,sheenColor:"#000000",sheenRoughness:0,iridescence:0,iridescenceIOR:1.5,iridescenceThickness:400,specularColor:"#ffffff",specularIntensity:1,matte:!1,flatShading:!1,castShadow:!0},multipleImportanceSampling:!0,denoiseEnabled:!0,denoiseSigma:2.5,denoiseThreshold:.1,denoiseKSigma:1,bounces:5,renderScale:1/window.devicePixelRatio,transmissiveBounces:20,filterGlossyFactor:.5,tiles:3};window.location.hash.includes("transmission")?(e.materialProperties.metalness=0,e.materialProperties.roughness=.23,e.materialProperties.transmission=1,e.materialProperties.color="#ffffff",e.bounces=10,e.tiles=2):window.location.hash.includes("iridescent")?(e.materialProperties.color="#474747",e.materialProperties.roughness=.25,e.materialProperties.metalness=1,e.materialProperties.iridescence=1,e.materialProperties.iridescenceIOR=2.2):window.location.hash.includes("acrylic")&&(e.materialProperties.color="#ffffff",e.materialProperties.roughness=0,e.materialProperties.metalness=0,e.materialProperties.transmission=1,e.materialProperties.attenuationDistance=.75,e.materialProperties.attenuationColor="#2a6dc6",e.bounces=20,e.tiles=3);const N=window.innerWidth/window.innerHeight;N<.65&&(e.bounces=Math.max(e.bounces,6),e.renderScale*=.5,e.tiles=2,e.multipleImportanceSampling=!1);W();async function W(){E.init(),p=new _,p.attach(document.body),n=new I({antialias:!0}),n.toneMapping=F,n.toneMappingExposure=.02,document.body.appendChild(n.domElement),o=new z(n),o.tiles.set(e.tiles,e.tiles),o.textureSize.set(2048,2048),o.renderToCanvasCallback=(h,u,C)=>{d.material.sigma=e.denoiseSigma,d.material.threshold=e.denoiseThreshold,d.material.kSigma=e.denoiseKSigma,d.material.opacity=C.material.opacity;const x=u.autoClear,v=e.denoiseEnabled?d:C;u.autoClear=!1,v.material.map=h.texture,v.render(u),u.autoClear=x},d=new k(new L({map:null,blending:R,premultipliedAlpha:n.getContextAttributes().premultipliedAlpha})),c=new D,window.SCENE=c;const t=await new Q().loadAsync();c.add(t.scene),s=t.camera,i=t.material,c.attach(s),s.removeFromParent(),g=new B(s,n.domElement),g.addEventListener("change",()=>o.updateCamera());const f=new T(0,0,-1).transformDirection(s.matrixWorld).normalize();g.target.copy(s.position).addScaledVector(f,25),g.update(),p.setPercentage(1),p.setCredits(O),a(),S(),window.addEventListener("resize",S);const P=new M,l=P.addFolder("Path Tracer");l.add(e,"multipleImportanceSampling").onChange(a),l.add(e,"tiles",1,4,1).onChange(h=>{o.tiles.set(h,h)}),l.add(e,"filterGlossyFactor",0,1).onChange(a),l.add(e,"bounces",1,30,1).onChange(a),l.add(e,"transmissiveBounces",0,40,1).onChange(a),l.add(e,"renderScale",.1,1).onChange(a);const m=P.addFolder("Denoising");m.add(e,"denoiseEnabled"),m.add(e,"denoiseSigma",.01,12),m.add(e,"denoiseThreshold",.01,1),m.add(e,"denoiseKSigma",0,12),m.close();const r=P.addFolder("Material");r.addColor(e.materialProperties,"color").onChange(a),r.addColor(e.materialProperties,"emissive").onChange(a),r.add(e.materialProperties,"emissiveIntensity",0,50,.01).onChange(a),r.add(e.materialProperties,"roughness",0,1).onChange(a),r.add(e.materialProperties,"metalness",0,1).onChange(a),r.add(e.materialProperties,"opacity",0,1).onChange(a),r.add(e.materialProperties,"transmission",0,1).onChange(a),r.add(e.materialProperties,"thinFilm",0,1).onChange(a),r.add(e.materialProperties,"attenuationDistance",.05,2).onChange(a),r.addColor(e.materialProperties,"attenuationColor").onChange(a),r.add(e.materialProperties,"ior",.9,3).onChange(a),r.add(e.materialProperties,"clearcoat",0,1).onChange(a),r.add(e.materialProperties,"clearcoatRoughness",0,1).onChange(a),r.addColor(e.materialProperties,"sheenColor").onChange(a),r.add(e.materialProperties,"sheenRoughness",0,1).onChange(a),r.add(e.materialProperties,"iridescence",0,1).onChange(a),r.add(e.materialProperties,"iridescenceIOR",.1,3).onChange(a),r.add(e.materialProperties,"iridescenceThickness",0,1200).onChange(a),r.addColor(e.materialProperties,"specularColor").onChange(a),r.add(e.materialProperties,"specularIntensity",0,1).onChange(a),r.add(e.materialProperties,"matte").onChange(a),r.add(e.materialProperties,"flatShading").onChange(a),r.add(e.materialProperties,"castShadow").onChange(a),r.close(),w()}function S(){n.setSize(window.innerWidth,window.innerHeight),n.setPixelRatio(window.devicePixelRatio),s.aspect=window.innerWidth/window.innerHeight,s.updateProjectionMatrix(),o.updateCamera()}function a(){const t=e.materialProperties;i.color.set(t.color),i.emissive.set(t.emissive),i.emissiveIntensity=t.emissiveIntensity,i.metalness=t.metalness,i.roughness=t.roughness,i.transmission=t.transmission,i.attenuationDistance=t.thinFilm?1/0:t.attenuationDistance,i.attenuationColor.set(t.attenuationColor),i.ior=t.ior,i.opacity=t.opacity,i.clearcoat=t.clearcoat,i.clearcoatRoughness=t.clearcoatRoughness,i.sheenColor.set(t.sheenColor),i.sheenRoughness=t.sheenRoughness,i.iridescence=t.iridescence,i.iridescenceIOR=t.iridescenceIOR,i.iridescenceThicknessRange=[0,t.iridescenceThickness],i.specularColor.set(t.specularColor),i.specularIntensity=t.specularIntensity,i.transparent=i.opacity<1,i.flatShading=t.flatShading,o.transmissiveBounces=e.transmissiveBounces,o.multipleImportanceSampling=e.multipleImportanceSampling,o.filterGlossyFactor=e.filterGlossyFactor,o.bounces=e.bounces,o.renderScale=e.renderScale,i.matte=t.matte,i.castShadow=t.castShadow,o.updateMaterials(),o.setScene(c,s)}function w(){requestAnimationFrame(w),o.renderSample(),p.setSamples(o.samples,o.isCompiling)}
