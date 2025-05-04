let e,t,r,a,o,n,i;function s(e,t,r,a){Object.defineProperty(e,t,{get:r,set:a,enumerable:!0,configurable:!0})}var l=globalThis,c={},d={},u=l.parcelRequire5b70;null==u&&((u=function(e){if(e in c)return c[e].exports;if(e in d){var t=d[e];delete d[e];var r={id:e,exports:{}};return c[e]=r,t.call(r.exports,r,r.exports),r.exports}var a=Error("Cannot find module '"+e+"'");throw a.code="MODULE_NOT_FOUND",a}).register=function(e,t){d[e]=t},l.parcelRequire5b70=u);var h=u.register;h("27Lyk",function(e,t){s(e.exports,"register",()=>r,e=>r=e),s(e.exports,"resolve",()=>a,e=>a=e);var r,a,o=new Map;r=function(e,t){for(var r=0;r<t.length-1;r+=2)o.set(t[r],{baseUrl:e,path:t[r+1]})},a=function(e){var t=o.get(e);if(null==t)throw Error("Could not resolve bundle with id "+e);return new URL(t.path,t.baseUrl).toString()}}),h("eLX8K",function(e,t){s(e.exports,"BlurredEnvMapGenerator",()=>l);var r=u("ilwiq"),a=u("RPVlj"),o=u("9fZ6X"),n=u("dUUQZ");class i extends o.MaterialBase{constructor(){super({uniforms:{envMap:{value:null},blur:{value:0}},vertexShader:`

				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}

			`,fragmentShader:`

				#include <common>
				#include <cube_uv_reflection_fragment>

				${n.util_functions}

				uniform sampler2D envMap;
				uniform float blur;
				varying vec2 vUv;
				void main() {

					vec3 rayDirection = equirectUvToDirection( vUv );
					gl_FragColor = textureCubeUV( envMap, rayDirection, blur );

				}

			`})}}class l{constructor(e){this.renderer=e,this.pmremGenerator=new r.PMREMGenerator(e),this.copyQuad=new a.FullScreenQuad(new i),this.renderTarget=new r.WebGLRenderTarget(1,1,{type:r.FloatType,format:r.RGBAFormat})}dispose(){this.pmremGenerator.dispose(),this.copyQuad.dispose(),this.renderTarget.dispose()}generate(e,t){let{pmremGenerator:a,renderTarget:o,copyQuad:n,renderer:i}=this,s=a.fromEquirectangular(e),{width:l,height:c}=e.image;o.setSize(l,c),n.material.envMap=s.texture,n.material.blur=t;let d=i.getRenderTarget(),u=i.autoClear;i.setRenderTarget(o),i.autoClear=!0,n.render(i),i.setRenderTarget(d),i.autoClear=u;let h=new Uint16Array(l*c*4),p=new Float32Array(l*c*4);i.readRenderTargetPixels(o,0,0,l,c,p);for(let e=0,t=p.length;e<t;e++)h[e]=(0,r.DataUtils).toHalfFloat(p[e]);let f=new r.DataTexture(h,l,c,r.RGBAFormat,r.HalfFloatType);return f.minFilter=e.minFilter,f.magFilter=e.magFilter,f.wrapS=e.wrapS,f.wrapT=e.wrapT,f.mapping=r.EquirectangularReflectionMapping,f.needsUpdate=!0,s.dispose(),f}}}),h("9fZ6X",function(e,t){s(e.exports,"MaterialBase",()=>a);var r=u("ilwiq");class a extends r.ShaderMaterial{set needsUpdate(e){super.needsUpdate=!0,this.dispatchEvent({type:"recompilation"})}constructor(e){for(let t in super(e),this.uniforms)Object.defineProperty(this,t,{get(){return this.uniforms[t].value},set(e){this.uniforms[t].value=e}})}setDefine(e,t){if(null==t){if(e in this.defines)return delete this.defines[e],this.needsUpdate=!0,!0}else if(this.defines[e]!==t)return this.defines[e]=t,this.needsUpdate=!0,!0;return!1}}}),h("dUUQZ",function(e,t){s(e.exports,"util_functions",()=>r);let r=`

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
`}),h("891vQ",function(e,t){s(e.exports,"RGBELoader",()=>a);var r=u("ilwiq");class a extends r.DataTextureLoader{constructor(e){super(e),this.type=r.HalfFloatType}parse(e){let t,a,o;let n=function(e,t){switch(e){case 1:throw Error("THREE.RGBELoader: Read Error: "+(t||""));case 2:throw Error("THREE.RGBELoader: Write Error: "+(t||""));case 3:throw Error("THREE.RGBELoader: Bad File Format: "+(t||""));default:throw Error("THREE.RGBELoader: Memory Error: "+(t||""))}},i=function(e,t,r){t=t||1024;let a=e.pos,o=-1,n=0,i="",s=String.fromCharCode.apply(null,new Uint16Array(e.subarray(a,a+128)));for(;0>(o=s.indexOf("\n"))&&n<t&&a<e.byteLength;)i+=s,n+=s.length,a+=128,s+=String.fromCharCode.apply(null,new Uint16Array(e.subarray(a,a+128)));return -1<o&&(!1!==r&&(e.pos+=n+o+1),i+s.slice(0,o))},s=new Uint8Array(e);s.pos=0;let l=function(e){let t,r;let a=/^\s*GAMMA\s*=\s*(\d+(\.\d+)?)\s*$/,o=/^\s*EXPOSURE\s*=\s*(\d+(\.\d+)?)\s*$/,s=/^\s*FORMAT=(\S+)\s*$/,l=/^\s*\-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/,c={valid:0,string:"",comments:"",programtype:"RGBE",format:"",gamma:1,exposure:1,width:0,height:0};for(!(e.pos>=e.byteLength)&&(t=i(e))||n(1,"no header found"),(r=t.match(/^#\?(\S+)/))||n(3,"bad initial token"),c.valid|=1,c.programtype=r[1],c.string+=t+"\n";!1!==(t=i(e));){if(c.string+=t+"\n","#"===t.charAt(0)){c.comments+=t+"\n";continue}if((r=t.match(a))&&(c.gamma=parseFloat(r[1])),(r=t.match(o))&&(c.exposure=parseFloat(r[1])),(r=t.match(s))&&(c.valid|=2,c.format=r[1]),(r=t.match(l))&&(c.valid|=4,c.height=parseInt(r[1],10),c.width=parseInt(r[2],10)),2&c.valid&&4&c.valid)break}return 2&c.valid||n(3,"missing format specifier"),4&c.valid||n(3,"missing image size specifier"),c}(s),c=l.width,d=l.height,u=function(e,t,r){if(t<8||t>32767||2!==e[0]||2!==e[1]||128&e[2])return new Uint8Array(e);t!==(e[2]<<8|e[3])&&n(3,"wrong scanline width");let a=new Uint8Array(4*t*r);a.length||n(4,"unable to allocate buffer space");let o=0,i=0,s=4*t,l=new Uint8Array(4),c=new Uint8Array(s),d=r;for(;d>0&&i<e.byteLength;){i+4>e.byteLength&&n(1),l[0]=e[i++],l[1]=e[i++],l[2]=e[i++],l[3]=e[i++],(2!=l[0]||2!=l[1]||(l[2]<<8|l[3])!=t)&&n(3,"bad rgbe scanline format");let r=0,u;for(;r<s&&i<e.byteLength;){let t=(u=e[i++])>128;if(t&&(u-=128),(0===u||r+u>s)&&n(3,"bad scanline data"),t){let t=e[i++];for(let e=0;e<u;e++)c[r++]=t}else c.set(e.subarray(i,i+u),r),r+=u,i+=u}for(let e=0;e<t;e++){let r=0;a[o]=c[e+r],r+=t,a[o+1]=c[e+r],r+=t,a[o+2]=c[e+r],r+=t,a[o+3]=c[e+r],o+=4}d--}return a}(s.subarray(s.pos),c,d);switch(this.type){case r.FloatType:let h=new Float32Array(4*(o=u.length/4));for(let e=0;e<o;e++)!function(e,t,r,a){let o=Math.pow(2,e[t+3]-128)/255;r[a+0]=e[t+0]*o,r[a+1]=e[t+1]*o,r[a+2]=e[t+2]*o,r[a+3]=1}(u,4*e,h,4*e);t=h,a=r.FloatType;break;case r.HalfFloatType:let p=new Uint16Array(4*(o=u.length/4));for(let e=0;e<o;e++)!function(e,t,a,o){let n=Math.pow(2,e[t+3]-128)/255;a[o+0]=(0,r.DataUtils).toHalfFloat(Math.min(e[t+0]*n,65504)),a[o+1]=(0,r.DataUtils).toHalfFloat(Math.min(e[t+1]*n,65504)),a[o+2]=(0,r.DataUtils).toHalfFloat(Math.min(e[t+2]*n,65504)),a[o+3]=(0,r.DataUtils).toHalfFloat(1)}(u,4*e,p,4*e);t=p,a=r.HalfFloatType;break;default:throw Error("THREE.RGBELoader: Unsupported type: "+this.type)}return{width:c,height:d,data:t,header:l.string,gamma:l.gamma,exposure:l.exposure,type:a}}setDataType(e){return this.type=e,this}load(e,t,a,o){return super.load(e,function(e,a){switch(e.type){case r.FloatType:case r.HalfFloatType:e.colorSpace=r.LinearSRGBColorSpace,e.minFilter=r.LinearFilter,e.magFilter=r.LinearFilter,e.generateMipmaps=!1,e.flipY=!0}t&&t(e,a)},a,o)}}}),h("cE5k3",function(e,t){s(e.exports,"getScaledSettings",()=>r);function r(){let e=3,t=Math.max(1/window.devicePixelRatio,.5);return window.innerWidth/window.innerHeight<.65&&(e=4,t=.5/window.devicePixelRatio),{tiles:e,renderScale:t}}}),h("e2Pv4",function(e,t){let r;s(e.exports,"LoaderElement",()=>a);class a{constructor(){r||((r=document.createElement("style")).textContent=`

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
	`,document.head.appendChild(r));let e=document.createElement("div");e.classList.add("loader-container");let t=document.createElement("div");t.classList.add("percentage"),e.appendChild(t);let a=document.createElement("div");a.classList.add("samples"),e.appendChild(a);let o=document.createElement("div");o.classList.add("credits"),e.appendChild(o);let n=document.createElement("div");n.classList.add("bar"),e.appendChild(n);let i=document.createElement("div");i.classList.add("description"),e.appendChild(i),this._description=i,this._loaderBar=n,this._percentage=t,this._credits=o,this._samples=a,this._container=e,this.setPercentage(0)}attach(e){e.appendChild(this._container),e.appendChild(this._description)}setPercentage(e){this._loaderBar.style.width=`${100*e}%`,0===e?this._percentage.innerText="Loading...":this._percentage.innerText=`${(100*e).toFixed(0)}%`,e>=1?this._container.classList.remove("loading"):this._container.classList.add("loading")}setSamples(e,t=!1){t?this._samples.innerText="compiling shader...":this._samples.innerText=`${Math.floor(e)} samples`}setCredits(e){this._credits.innerHTML=e}setDescription(e){this._description.innerHTML=e}}}),h("kqOCM",function(e,t){s(e.exports,"ParallelMeshBVHWorker",()=>h);var r=u("ilwiq"),a=u("6KVZ3"),o=u("3ePKg"),n=u("cSOJe"),i=u("a8VBx"),l=u("5Gkg5");let c="undefined"!=typeof navigator?navigator.hardwareConcurrency:4;class d extends o.WorkerBase{constructor(){if(super(new Worker(u("2tQrc"))),this.name="ParallelMeshBVHWorker",this.maxWorkerCount=Math.max(c,4),!(0,n.isSharedArrayBufferSupported)())throw Error("ParallelMeshBVHWorker: Shared Array Buffers are not supported.")}runTask(e,t,o={}){return new Promise((i,s)=>{if(t.index||o.indirect||(0,l.ensureIndex)(t,o),t.getAttribute("position").isInterleavedBufferAttribute||t.index&&t.index.isInterleavedBufferAttribute)throw Error("ParallelMeshBVHWorker: InterleavedBufferAttribute are not supported for the geometry attributes.");e.onerror=e=>{s(Error(`ParallelMeshBVHWorker: ${e.message}`))},e.onmessage=n=>{let{data:l}=n;if(l.error)s(Error(l.error)),e.onmessage=null;else if(l.serialized){let{serialized:n,position:s}=l,c=(0,a.MeshBVH).deserialize(n,t,{setIndex:!1}),d={setBoundingBox:!0,...o};if(t.attributes.position.array=s,n.index){if(t.index)t.index.array=n.index;else{let e=new r.BufferAttribute(n.index,1,!1);t.setIndex(e)}}d.setBoundingBox&&(t.boundingBox=c.getBoundingBox(new r.Box3)),o.onProgress&&o.onProgress(l.progress),i(c),e.onmessage=null}else o.onProgress&&o.onProgress(l.progress)};let c=t.index?t.index.array:null,d=t.attributes.position.array;e.postMessage({operation:"BUILD_BVH",maxWorkerCount:this.maxWorkerCount,index:(0,n.convertToBufferType)(c,SharedArrayBuffer),position:(0,n.convertToBufferType)(d,SharedArrayBuffer),options:{...o,onProgress:null,includedProgressCallback:!!o.onProgress,groups:[...t.groups]}})})}}class h{constructor(){if((0,n.isSharedArrayBufferSupported)())return new d;{console.warn("ParallelMeshBVHWorker: SharedArrayBuffers not supported. Falling back to single-threaded GenerateMeshBVHWorker.");let e=new i.GenerateMeshBVHWorker;return e.maxWorkerCount=c,e}}}}),h("3ePKg",function(e,t){s(e.exports,"WorkerBase",()=>r);class r{constructor(e){this.name="WorkerBase",this.running=!1,this.worker=e,this.worker.onerror=e=>{if(e.message)throw Error(`${this.name}: Could not create Web Worker with error "${e.message}"`);throw Error(`${this.name}: Could not create Web Worker.`)}}runTask(){}generate(...e){if(this.running)throw Error("GenerateMeshBVHWorker: Already running job.");if(null===this.worker)throw Error("GenerateMeshBVHWorker: Worker has been disposed.");this.running=!0;let t=this.runTask(this.worker,...e);return t.finally(()=>{this.running=!1}),t}dispose(){this.worker.terminate(),this.worker=null}}}),h("a8VBx",function(e,t){s(e.exports,"GenerateMeshBVHWorker",()=>n);var r=u("ilwiq"),a=u("6KVZ3"),o=u("3ePKg");class n extends o.WorkerBase{constructor(){super(new Worker(u("jVRlM"))),this.name="GenerateMeshBVHWorker"}runTask(e,t,o={}){return new Promise((n,i)=>{if(t.getAttribute("position").isInterleavedBufferAttribute||t.index&&t.index.isInterleavedBufferAttribute)throw Error("GenerateMeshBVHWorker: InterleavedBufferAttribute are not supported for the geometry attributes.");e.onerror=e=>{i(Error(`GenerateMeshBVHWorker: ${e.message}`))},e.onmessage=s=>{let{data:l}=s;if(l.error)i(Error(l.error)),e.onmessage=null;else if(l.serialized){let{serialized:i,position:s}=l,c=(0,a.MeshBVH).deserialize(i,t,{setIndex:!1}),d=Object.assign({setBoundingBox:!0},o);if(t.attributes.position.array=s,i.index){if(t.index)t.index.array=i.index;else{let e=new r.BufferAttribute(i.index,1,!1);t.setIndex(e)}}d.setBoundingBox&&(t.boundingBox=c.getBoundingBox(new r.Box3)),o.onProgress&&o.onProgress(l.progress),n(c),e.onmessage=null}else o.onProgress&&o.onProgress(l.progress)};let s=t.index?t.index.array:null,l=t.attributes.position.array,c=[l];s&&c.push(s),e.postMessage({index:s,position:l,options:{...o,onProgress:null,includedProgressCallback:!!o.onProgress,groups:[...t.groups]}},c.map(e=>e.buffer).filter(e=>"undefined"==typeof SharedArrayBuffer||!(e instanceof SharedArrayBuffer)))})}}}),h("jVRlM",function(e,t){var r=u("7ryUf");let a=new URL("generateMeshBVH.worker.373f3c58.js",import.meta.url);e.exports=r(a.toString(),a.origin,!0)}),h("7ryUf",function(e,t){e.exports=function(e,t,r){if(t===self.location.origin)return e;var a=r?"import "+JSON.stringify(e)+";":"importScripts("+JSON.stringify(e)+");";return URL.createObjectURL(new Blob([a],{type:"application/javascript"}))}}),h("2tQrc",function(e,t){var r=u("7ryUf");let a=new URL("parallelMeshBVH.worker.22cf4bb0.js",import.meta.url);e.exports=r(a.toString(),a.origin,!0)}),h("fYvb1",function(e,t){s(e.exports,"math_functions",()=>r);let r=`

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

`}),h("8keuf",function(e,t){s(e.exports,"ggx_functions",()=>r);let r=`

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

`}),u("27Lyk").register(new URL("",import.meta.url).toString(),JSON.parse('["0iKVa","depthOfField.0cc6d401.js","512E4","parallelMeshBVH.worker.22cf4bb0.js","9P1cE","generateMeshBVH.worker.cd4b9fc6.js","lWWke","generateMeshBVH.worker.373f3c58.js","9P1cE","generateMeshBVH.worker.cd4b9fc6.js","jwbL2","aoRender.e5303912.js","bjWyA","aoRender.d33f21b3.js","2tzBs","aoRender.89c1b67b.js","6UuCC","aoRender.5fc59dbe.js","6mMEU","aoRender.fc8349f1.js","i0zVc","aoRender.dcf40b33.js","j19h5","aoRender.e8b1599c.js","5lTJX","areaLight.1c24b9b9.js","eL2Kp","areaLight.2aa801de.js"]'));var p=u("ilwiq"),f=u("7lx9d"),m=u("5Rd1x"),g=u("eLX8K"),v=u("bHiTZ"),w=u("kLfIo"),b=u("8mHfG"),x=u("891vQ"),y=u("kp7Te"),T=u("jiuw3"),B=u("cE5k3"),E=u("e2Pv4"),P=u("kqOCM");const S=new p.Vector2,M=new p.Vector3,k={bounces:3,renderScale:1/window.devicePixelRatio,filterGlossyFactor:.5,tiles:1,autoFocus:!0,...(0,B.getScaledSettings)()};function C(e){S.set(e.clientX,e.clientY)}function F(t){if(Math.abs(S.x-t.clientX)+Math.abs(S.y-t.clientY)<2&&n){let r=new p.Raycaster;r.setFromCamera({x:t.clientX/window.innerWidth*2-1,y:-(t.clientY/window.innerHeight*2)+1},a);let o=n.raycastFirst(r.ray);o&&(M.copy(o.point),a.focusDistance=o.distance-a.near,e.updateCamera())}}function R(){t.setSize(window.innerWidth,window.innerHeight),t.setPixelRatio(window.devicePixelRatio),a.aspect=window.innerWidth/window.innerHeight,a.updateProjectionMatrix(),e.updateCamera()}function L(){e.filterGlossyFactor=k.filterGlossyFactor,e.bounces=k.bounces,e.renderScale=k.renderScale,e.updateCamera(),e.reset()}!async function(){(i=new E.LoaderElement).attach(document.body),(t=new p.WebGLRenderer({antialias:!0})).toneMapping=p.ACESFilmicToneMapping,document.body.appendChild(t.domElement),(e=new b.WebGLPathTracer(t)).setBVHWorker(new P.ParallelMeshBVHWorker),e.tiles.set(k.tiles,k.tiles),(a=new w.PhysicalCamera(60,window.innerWidth/window.innerHeight,.025,500)).position.set(-.262,.5276,-1.1606),a.apertureBlades=6,a.fStop=.6,a.focusDistance=1.1878,M.set(-.5253353217832674,.3031596413506029,777794185259223e-18);let s=new v.GradientEquirectTexture;s.topColor.set(3739424).convertSRGBToLinear(),s.bottomColor.set(1383199).convertSRGBToLinear(),s.update(),(o=new p.Scene).background=s,o.environmentIntensity=.5,(r=new m.OrbitControls(a,t.domElement)).target.set(-.182,.147,.06),r.update(),r.addEventListener("change",()=>{k.autoFocus&&(a.focusDistance=a.position.distanceTo(M)-a.near),e.updateCamera()});let[l,c]=await Promise.all([new(0,x.RGBELoader)().loadAsync("https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr"),new(0,f.GLTFLoader)().setMeshoptDecoder(y.MeshoptDecoder).loadAsync("https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/sd-macross-city-standoff-diorama/scene.glb")]),d=new g.BlurredEnvMapGenerator(t),u=d.generate(l,.35);d.dispose(),l.dispose(),o.environment=u;let h=new p.SphereGeometry(1,10,10),B=new p.MeshStandardMaterial({emissiveIntensity:10,emissive:16777215});for(let e=0;e<300;e++){let e=new p.Mesh(h,B);e.scale.setScalar(.075*Math.random()+.03),e.position.randomDirection().multiplyScalar(30+15*Math.random()),o.add(e)}c.scene.scale.setScalar(.5),c.scene.traverse(e=>{e.material&&(e.material.roughness=.05,e.material.metalness=.05)}),o.add(c.scene),o.updateMatrixWorld(!0),n=(await e.setSceneAsync(o,a,{onProgress:e=>i.setPercentage(e)})).bvh,i.setCredits("Model by tipatat on Sketchfab"),i.setDescription("Path tracing with configurable bokeh and depth of field. Click point in scene to focus."),L(),R(),window.addEventListener("resize",R),t.domElement.addEventListener("mouseup",F),t.domElement.addEventListener("mousedown",C);let S=new T.GUI,V=S.addFolder("Path Tracer");V.add(k,"tiles",1,4,1).onChange(t=>{e.tiles.set(t,t)}),V.add(k,"bounces",1,30,1).onChange(L),V.add(k,"renderScale",.1,1).onChange(L);let G=S.addFolder("Camera");G.add(a,"focusDistance",1,100).onChange(L).listen(),G.add(a,"apertureBlades",0,10,1).onChange(function(e){a.apertureBlades=0===e?0:Math.max(e,3),this.updateDisplay(),L()}),G.add(a,"apertureRotation",0,12.5).onChange(L),G.add(a,"anamorphicRatio",.1,10).onChange(L),G.add(a,"bokehSize",0,100).onChange(L).listen(),G.add(a,"fStop",.02,20).onChange(L).listen(),G.add(a,"fov",25,100).onChange(()=>{a.updateProjectionMatrix(),e.updateCamera()}).listen(),G.add(k,"autoFocus"),function t(){requestAnimationFrame(t),e.renderSample(),i.setSamples(e.samples,e.isCompiling)}()}();
//# sourceMappingURL=depthOfField.0cc6d401.js.map
