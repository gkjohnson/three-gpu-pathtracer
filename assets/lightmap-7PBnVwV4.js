import{A as e,B as t,C as n,D as r,E as i,F as a,G as o,H as ee,I as s,K as te,L as c,M as ne,O as l,P as re,R as ie,S as u,T as d,U as f,V as p,W as m,_ as h,a as g,b as _,c as ae,g as v,i as y,j as oe,k as se,l as b,n as x,o as ce,p as S,q as le,r as C,s as ue,t as de,v as w,w as T,y as E}from"./main-CUi3Zr8A.js";var fe=class extends x{constructor(e,t={}){super(e);let{originOffset:n=1e-4}=t;this.originOffset=a(n)}_getCameraRayNode(){let e=this._getTexelSurfaceNode(),{originOffset:t}=this;return E`
			fn getCameraRay( uvIn: vec2f, resolution: vec2f, ray: ptr<function, ${u}> ) -> bool {

				var texel: ${C};
				if ( ! ${e}( uvIn, &texel ) ) {

					return false;

				}

				ray.origin = texel.position + texel.faceNormal * ${t};
				ray.direction = - texel.faceNormal;
				ray.maxDist = 2.0 * ${t};
				return true;

			}
		`}},pe=class extends b{updateFunctions(){super.updateFunctions();let{structs:e,fns:t}=this,n=t.getSurfaceRecord.proxyNode,r=t.bsdfSample.proxyNode,i=t.bsdfEvalPdf.proxyNode;t.getSurfaceRecord=E`

			fn lightmapGetSurfaceRecord(
				material: ${e.material},
				objectColor: vec4f,
				vertexData: ${_(`bvhData.structs.attributes`)},
				hit: ${h},
				view: vec3f,
				blurRoughness: f32,
			) -> ${e.surfaceRecord} {

				var surf = ${n}( material, objectColor, vertexData, hit, view, blurRoughness );
				if ( hit.bounce == 0u ) {

					surf.emission = vec3f( 0.0 );
					surf.color = vec3f( 1.0 );

				}

				return surf;

			}

		`,t.bsdfSample=E`

			fn lightmapBsdfSample( hit: ${h}, surf: ${e.surfaceRecord}, worldWo: vec3f ) -> ${w} {

				if ( hit.bounce == 0u ) {

					var record: ${w};
					let wo = normalize( surf.normalInvBasis * worldWo );
					let wi = ${S}( wo, ${v}( ${3} ) );
					record.color = vec3f( max( wi.z, 0.0 ) );
					record.pdf = max( wi.z, 0.0 ) / PI;
					record.direction = normalize( surf.normalBasis * wi );
					return record;

				}

				return ${r}( hit, surf, worldWo );

			}

		`,t.bsdfEvalPdf=E`

			fn lightmapBsdfEvalPdf( hit: ${h}, surf: ${e.surfaceRecord}, worldWo: vec3f, worldWi: vec3f ) -> ${w} {

				if ( hit.bounce == 0u ) {

					var record: ${w};
					record.direction = worldWi;
					let wi = normalize( surf.normalInvBasis * worldWi );
					record.color = vec3f( max( wi.z, 0.0 ) );
					record.pdf = max( wi.z, 0.0 ) / PI;
					return record;

				}

				return ${i}( hit, surf, worldWo, worldWi );

			}

		`}},me=class extends l{setup(e){let{iblIrradiance:t}=e.context;e.context.iblIrradiance=c(0).toVar(),super.setup(e),e.context.iblIrradiance=t}},he=class extends e{setupEnvironment(e){let t=this.envNode||e.environmentNode;return t?new me(t):null}},ge=`https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/FlightHelmet/glTF/FlightHelmet.gltf`,_e=`https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/chinese_garden_1k.hdr`,ve=new URL(``+new URL(`rt_hdr_alb_nrm-BtuxMGcR.tza`,import.meta.url).href,``+import.meta.url).toString(),D=`Flight Helmet model from the Khronos glTF sample models`,O=`Irradiance baked into a uv atlas and applied as a lightmap.`,k=2048,A=16,j={view:`pbr`,resolution:k,regenerate:()=>N.reset()},M,N,P,F,I,L,R,z,B,V,H,U,W,G,K,q,J,Y;ye();async function ye(){I=new n,I.attach(document.body);let{maxStorageBuffersPerShaderStage:e,maxStorageBufferBindingSize:a,maxBufferSize:c}=(await navigator.gpu.requestAdapter()).limits;M=new oe({antialias:!0,requiredLimits:{maxStorageBuffersPerShaderStage:e,maxStorageBufferBindingSize:a,maxBufferSize:c},trackTimestamp:!0}),M.toneMapping=4,await M.init(),document.body.appendChild(M.domElement);let[l,u]=await Promise.all([new r().loadAsync(ge),new i().loadAsync(_e)]);u.mapping=303,L=l.scene;let h=new ie().setFromObject(L),{center:g,radius:_}=h.getBoundingSphere(new te),v=new t(new m(6*_,6*_),new ee({roughness:1}));v.rotation.x=-Math.PI/2,v.position.y=h.min.y,L.add(v);let y=new ce;y.resolution=k,y.useInputUVs=!0,await y.generate(L),K=L.clone(),q=[],K.traverse(e=>{e.isMesh&&(e.material=new he().copy(e.material),q.push(e.material))}),J=L.clone(),Y=new p,J.traverse(e=>{e.isMesh&&(e.material=Y)}),F=new o,F.environment=u,F.add(K,J);let b=new o;b.environment=u,b.background=u,b.add(L),R=new fe(L),N=new ae(M),N.synchronizeRenderSize=!1,N.renderToCanvas=!1,N.maxSamples=A,N.setShadingModel(new pe),N.addEventListener(`progress`,({stage:e,progress:t,samples:n})=>{I.setStage(e,t,n)}),N.setScene(b,R),X(j.resolution);let x=new ue({initUNetFromURL:de,auxWeightsUrl:ve,onBeforeDenoise:(e,t,n)=>{let r=R.idTexture.texture;return{color:z.fill(e,r,B),albedo:z.fill(t,r,V),normal:z.fill(n,r,H)}}});N.setDenoiser(x),N.addEventListener(`complete`,()=>{Z(U.update(x.texture))}),P=new f(50,1,.01,100),P.position.set(g.x+_*.9,g.y+_*.6,g.z+_*2.6);let S=new d(P,M.domElement);S.target.set(g.x,g.y+_*.1,g.z),S.update(),W=re(new le,s()),G=new ne(new se({colorNode:W}));let C=new T;C.add(j,`view`,[`pbr`,`map`,`texture`]),C.add(j,`resolution`,[128,256,512,1024,2048,4096]).onChange(X),C.add(N,`maxSamples`,1,100,1),C.add(j,`regenerate`),I.setPercentage(1),I.setCredits(D),I.setDescription(O),window.addEventListener(`resize`,Q),Q(),$()}function X(e){z?.dispose(),B?.dispose(),V?.dispose(),H?.dispose(),U?.dispose(),N.setSize(e,e),z=new g(M,e),B=z.createTarget(),V=z.createTarget(),H=z.createTarget(),U=new y(M,L,R.idTexture.texture)}function Z(e){e.channel=1,Y.map=e;for(let t of q)t.lightMap=e}function Q(){M.setSize(window.innerWidth,window.innerHeight),M.setPixelRatio(window.devicePixelRatio),P.aspect=window.innerWidth/window.innerHeight,P.updateProjectionMatrix()}function $(){requestAnimationFrame($),N.renderSample(),N.complete||Z(N.target),j.view===`texture`?be(Y.map):(K.visible=j.view===`pbr`,J.visible=j.view===`map`,M.render(F,P))}function be(e){let t=Math.min(window.innerWidth,window.innerHeight);W.value=e,M.setViewport((window.innerWidth-t)/2,(window.innerHeight-t)/2,t,t),G.render(M),M.setViewport(0,0,window.innerWidth,window.innerHeight)}