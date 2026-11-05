import{C as e,D as t,E as n,F as r,G as i,I as a,K as o,M as ee,N as s,P as te,R as ne,S as c,T as l,U as u,V as d,_ as f,a as p,b as m,c as re,d as h,f as g,g as _,h as v,i as y,j as ie,k as ae,m as b,n as oe,o as se,q as ce,r as le,s as ue,t as de,u as x,v as S,w as fe,x as C,y as w,z as T}from"./main-CUi3Zr8A.js";var E=class extends oe{_getCameraRayNode(){let e=this._getTexelSurfaceNode(),t=m(`bvhData.storage.transforms`),n=m(`shadingModel.storage.materials`),r=C(`bvhData.fns.sampleTrianglePoint`),i=C(`shadingModel.fns.getSurfaceRecord`);return w`
			fn getCameraRay( uvIn: vec2f, resolution: vec2f, ray: ptr<function, ${c}> ) -> bool {

				var texel: ${le};
				if ( ! ${e}( uvIn, &texel ) ) {

					return false;

				}

				// the shading normal from the material
				let objectInfo = ${t}[ texel.slot ];
				var vertexData = ${r}( texel.barycoord, texel.indices );
				vertexData.normal = normalize( transpose( objectInfo.inverseMatrixWorld ) * vertexData.normal );
				vertexData.tangent = vec4f( ( objectInfo.matrixWorld * vec4f( vertexData.tangent.xyz, 0.0 ) ).xyz, vertexData.tangent.w );
				vertexData.position = objectInfo.matrixWorld * vertexData.position;

				var hit: ${f};
				hit.barycoord = texel.barycoord;
				hit.objectIndex = i32( texel.slot );
				hit.normal = texel.faceNormal;
				hit.side = 1.0;
				hit.indices = texel.indices;

				let materialInfo = ${n}[ objectInfo.materialIndex ];
				let surface = ${i}( materialInfo, objectInfo.color, vertexData, hit, texel.faceNormal, 0.0 );

				// sample around the shading normal, mirroring directions below the triangle back above it
				var direction = ${b}( surface.normal, ${_}( ${4} ) );
				let below = dot( direction, texel.faceNormal );
				if ( below < 0.0 ) {

					direction -= 2.0 * below * texel.faceNormal;

				}

				ray.direction = direction;
				ray.origin = ${v}( texel.position, direction, texel.faceNormal );
				ray.maxDist = 0.0;
				return true;

			}
		`}},D=new s({map:`int`,alphaMap:`int`,normalMap:`int`,vertexColors:`int`,opacity:`float`,alphaTest:`float`,side:`float`,transparent:`int`,flatShading:`int`,_alignment0:`int`,normalScale:`vec2`,mapTransform:`mat3`,alphaMapTransform:`mat3`,normalMapTransform:`mat3`},`Material`),pe=new s({normal:`vec3f`,frontFace:`bool`,eta:`f32`,f0:`f32`,roughness:`f32`,metalness:`f32`,color:`vec3f`,emission:`vec3f`,opacity:`f32`,matte:`bool`,ior:`f32`,transmission:`f32`,thinWall:`bool`,attenuationColor:`vec3f`,attenuationDistance:`f32`,dispersion:`f32`,multiscatterColor:`vec3f`,scatterStrength:`f32`,scatterAnisotropy:`f32`},`SurfaceRecord`),me=class extends x{constructor(e={}){super();let{radius:t=1,falloff:n=!0}=e;this.radius=r(t),this.falloff=r(+!!n,`uint`)}updateFunctions(){super.updateFunctions();let{structs:e,fns:t,radius:n,falloff:r}=this;e.material=D,e.surfaceRecord=pe;let i=C(`bvhData.fns.getUvFromChannel`),a=C(`bvhData.fns.getColor`);t.getSurfaceRecord=w`

			fn getSurfaceRecord(
				material: ${e.material},
				objectColor: vec4f,
				vertexData: ${m(`bvhData.structs.attributes`)},
				hit: ${f},
				view: vec3f,
				blurRoughness: f32,
			) -> ${e.surfaceRecord} {

				let side = hit.side;
				let faceNormal = hit.normal;

				// "faceNormal" is provided on the hit side so flip it back to the geometric side
				var normal = faceNormal * side;
				if ( material.flatShading == 0 ) {

					normal = normalize( vertexData.normal.xyz );

				}

				// some provided tangents can be malformed (0, 0, 0) causing the normal to be degenerate
				if ( material.normalMap != -1 && length( vertexData.tangent.xyz ) > 0.0 && vertexData.tangent.w != 0.0 ) {

					let tangent = normalize( vertexData.tangent.xyz );
					let bitangent = normalize( cross( normal, tangent ) * vertexData.tangent.w );
					let vTBN = mat3x3f( tangent, bitangent, normal );

					let uvPrime = material.normalMapTransform * vec3( ${i}( vertexData, material.normalMap ), 1.0 );
					var texNormal = ${t.sampleTexel}( uvPrime.xy, material.normalMap, 0 ).xyz;
					texNormal = texNormal * 2.0 - 1.0;
					texNormal = texNormal * vec3f( material.normalScale, 1.0 );
					normal = normalize( vTBN * texNormal );

				}

				normal *= side;
				normal = ${g}( normal, faceNormal, view );
				normal = ${h}( normal, faceNormal, view );

				var opacity = material.opacity * objectColor.a;
				if ( material.vertexColors == 1 ) {

					opacity *= ${a}( vertexData ).a;

				}

				if ( material.map != -1 ) {

					let uvPrime = material.mapTransform * vec3f( ${i}( vertexData, material.map ), 1 );
					opacity *= ${t.sampleTexel}( uvPrime.xy, material.map, 0 ).a;

				}

				if ( material.alphaMap != -1 ) {

					let uvPrime = material.alphaMapTransform * vec3f( ${i}( vertexData, material.alphaMap ), 1 );
					opacity *= ${t.sampleTexel}( uvPrime.xy, material.alphaMap, 0 ).g;

				}

				// occluders past the radius count as open
				var occlusion = step( ${n}, hit.dist );
				if ( ${r} != 0u ) {

					occlusion = smoothstep( 0.0, ${n}, hit.dist );

				}

				var surf: ${e.surfaceRecord};
				surf.normal = normal;
				surf.frontFace = true;
				surf.thinWall = true;
				surf.color = vec3f( 1.0 );
				surf.emission = vec3f( occlusion );
				surf.roughness = 1.0;
				surf.opacity = select( 1.0, opacity, material.transparent != 0 );
				return surf;

			}

		`,t.bsdfSample=w`

			fn aoBsdfSample( hit: ${f}, surf: ${e.surfaceRecord}, worldWo: vec3f ) -> ${S} {

				var record: ${S};
				record.color = vec3f( 0.0 );
				record.pdf = 0.0;
				record.direction = worldWo;
				return record;

			}

		`,t.bsdfEvalPdf=w`

			fn aoBsdfEvalPdf( hit: ${f}, surf: ${e.surfaceRecord}, worldWo: vec3f, worldWi: vec3f ) -> ${S} {

				var record: ${S};
				record.color = vec3f( 0.0 );
				record.pdf = 0.0;
				record.direction = worldWi;
				return record;

			}

		`}writeMaterialsBuffer(e){let t=D.getLength(),n=new Float32Array(Math.max(e.length,2)*t),r=new Int32Array(n.buffer);for(let i=0,a=e.length;i<a;i++){let a=e[i],o=i*t;r[o++]=this.getTextureDescriptor(a,`map`),r[o++]=this.getTextureDescriptor(a,`alphaMap`),r[o++]=this.getTextureDescriptor(a,`normalMap`),r[o++]=Number(a.vertexColors),n[o++]=a.opacity,n[o++]=a.alphaTest,n[o++]=0,r[o++]=Number(a.transparent),r[o++]=Number(a.flatShading),o++,n[o++]=`normalScale`in a?a.normalScale.x:1,n[o++]=`normalScale`in a?a.normalScale.y:1,o+=this.writeTextureMatrixToArray(a,`map`,n,o),o+=this.writeTextureMatrixToArray(a,`alphaMap`,n,o),o+=this.writeTextureMatrixToArray(a,`normalMap`,n,o)}return{materialData:r}}},he=`https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/FlightHelmet/glTF/FlightHelmet.gltf`,ge=`https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/chinese_garden_1k.hdr`,_e=new URL(``+new URL(`rt_hdr-QHWJbaMj.tza`,import.meta.url).href,``+import.meta.url).toString(),O=`Flight Helmet model from the Khronos glTF sample models`,k=`Ambient occlusion baked into a uv atlas and displayed as the only shading.`,A=2048,j=16,M=.1,N={view:`map`,resolution:A,regenerate:()=>F.reset()},P,F,I,L,R,z,B,V,H,U,W,G,K,q,J,Y;ve();async function ve(){R=new e,R.attach(document.body);let{maxStorageBuffersPerShaderStage:r,maxStorageBufferBindingSize:s,maxBufferSize:c}=(await navigator.gpu.requestAdapter()).limits;P=new ie({antialias:!0,requiredLimits:{maxStorageBuffersPerShaderStage:r,maxStorageBufferBindingSize:s,maxBufferSize:c},trackTimestamp:!0}),await P.init(),document.body.appendChild(P.domElement);let[f,p]=await Promise.all([new t().loadAsync(he),new n().loadAsync(ge)]);p.mapping=303,z=f.scene;let m=new se;m.resolution=A,m.useInputUVs=!0,await m.generate(z);let{center:h,radius:g}=new ne().setFromObject(z).getBoundingSphere(new o);K=z.clone(),q=[],K.traverse(e=>{e.isMesh&&(e.material=e.material.clone(),q.push(e.material))}),J=z.clone(),Y=new d,J.traverse(e=>{e.isMesh&&(e.material=Y)}),L=new i,L.environment=p,L.add(K,J);let _=new i;_.background=new T(16777215),_.add(z),B=new E(z),F=new re(P),F.synchronizeRenderSize=!1,F.renderToCanvas=!1,F.maxSamples=j,F.setShadingModel(new me({radius:M})),F.addEventListener(`progress`,({stage:e,progress:t,samples:n})=>{R.setStage(e,t,n)}),F.setScene(_,B),X(N.resolution);let v=new ue({initUNetFromURL:de,colorWeightsUrl:_e,useAuxiliaryBuffers:!1,onBeforeDenoise:e=>({color:V.fill(e,B.idTexture.texture,H)})});F.setDenoiser(v),F.addEventListener(`complete`,()=>{Z(U.update(v.texture))}),I=new u(50,1,.01,100),I.position.set(h.x+g*.9,h.y+g*.6,h.z+g*2.6);let y=new l(I,P.domElement);y.target.set(h.x,h.y+g*.1,h.z),y.update(),W=te(new ce,a()),G=new ee(new ae({colorNode:W}));let b=new fe;b.add(N,`view`,[`pbr`,`map`,`texture`]),b.add(N,`resolution`,[128,256,512,1024,2048,4096]).onChange(X),b.add(F,`maxSamples`,1,100,1),b.add(N,`regenerate`),R.setPercentage(1),R.setCredits(O),R.setDescription(k),window.addEventListener(`resize`,Q),Q(),$()}function X(e){V?.dispose(),H?.dispose(),U?.dispose(),F.setSize(e,e),V=new p(P,e),H=V.createTarget(),U=new y(P,z,B.idTexture.texture)}function Z(e){e.channel=1,Y.map=e;for(let t of q)t.aoMap=e}function Q(){P.setSize(window.innerWidth,window.innerHeight),P.setPixelRatio(window.devicePixelRatio),I.aspect=window.innerWidth/window.innerHeight,I.updateProjectionMatrix()}function $(){requestAnimationFrame($),F.renderSample(),F.complete||Z(F.target),N.view===`texture`?ye(Y.map):(K.visible=N.view===`pbr`,J.visible=N.view===`map`,P.render(L,I))}function ye(e){let t=Math.min(window.innerWidth,window.innerHeight);W.value=e,P.setViewport((window.innerWidth-t)/2,(window.innerHeight-t)/2,t,t),G.render(P),P.setViewport(0,0,window.innerWidth,window.innerHeight)}