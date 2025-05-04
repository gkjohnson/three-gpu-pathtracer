let e,t,r,a,o,n,i,s;function l(e,t,r,a){Object.defineProperty(e,t,{get:r,set:a,enumerable:!0,configurable:!0})}var d=globalThis,c={},u={},h=d.parcelRequire5b70;null==h&&((h=function(e){if(e in c)return c[e].exports;if(e in u){var t=u[e];delete u[e];var r={id:e,exports:{}};return c[e]=r,t.call(r.exports,r,r.exports),r.exports}var a=Error("Cannot find module '"+e+"'");throw a.code="MODULE_NOT_FOUND",a}).register=function(e,t){u[e]=t},d.parcelRequire5b70=h);var p=h.register;p("27Lyk",function(e,t){l(e.exports,"register",()=>r,e=>r=e),l(e.exports,"resolve",()=>a,e=>a=e);var r,a,o=new Map;r=function(e,t){for(var r=0;r<t.length-1;r+=2)o.set(t[r],{baseUrl:e,path:t[r+1]})},a=function(e){var t=o.get(e);if(null==t)throw Error("Could not resolve bundle with id "+e);return new URL(t.path,t.baseUrl).toString()}}),p("d4kES",function(e,t){l(e.exports,"PhysicalSpotLight",()=>a);var r=h("ilwiq");class a extends r.SpotLight{constructor(...e){super(...e),this.iesMap=null,this.radius=0}copy(e,t){return super.copy(e,t),this.iesMap=e.iesMap,this.radius=e.radius,this}}}),p("891vQ",function(e,t){l(e.exports,"RGBELoader",()=>a);var r=h("ilwiq");class a extends r.DataTextureLoader{constructor(e){super(e),this.type=r.HalfFloatType}parse(e){let t,a,o;let n=function(e,t){switch(e){case 1:throw Error("THREE.RGBELoader: Read Error: "+(t||""));case 2:throw Error("THREE.RGBELoader: Write Error: "+(t||""));case 3:throw Error("THREE.RGBELoader: Bad File Format: "+(t||""));default:throw Error("THREE.RGBELoader: Memory Error: "+(t||""))}},i=function(e,t,r){t=t||1024;let a=e.pos,o=-1,n=0,i="",s=String.fromCharCode.apply(null,new Uint16Array(e.subarray(a,a+128)));for(;0>(o=s.indexOf("\n"))&&n<t&&a<e.byteLength;)i+=s,n+=s.length,a+=128,s+=String.fromCharCode.apply(null,new Uint16Array(e.subarray(a,a+128)));return -1<o&&(!1!==r&&(e.pos+=n+o+1),i+s.slice(0,o))},s=new Uint8Array(e);s.pos=0;let l=function(e){let t,r;let a=/^\s*GAMMA\s*=\s*(\d+(\.\d+)?)\s*$/,o=/^\s*EXPOSURE\s*=\s*(\d+(\.\d+)?)\s*$/,s=/^\s*FORMAT=(\S+)\s*$/,l=/^\s*\-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/,d={valid:0,string:"",comments:"",programtype:"RGBE",format:"",gamma:1,exposure:1,width:0,height:0};for(!(e.pos>=e.byteLength)&&(t=i(e))||n(1,"no header found"),(r=t.match(/^#\?(\S+)/))||n(3,"bad initial token"),d.valid|=1,d.programtype=r[1],d.string+=t+"\n";!1!==(t=i(e));){if(d.string+=t+"\n","#"===t.charAt(0)){d.comments+=t+"\n";continue}if((r=t.match(a))&&(d.gamma=parseFloat(r[1])),(r=t.match(o))&&(d.exposure=parseFloat(r[1])),(r=t.match(s))&&(d.valid|=2,d.format=r[1]),(r=t.match(l))&&(d.valid|=4,d.height=parseInt(r[1],10),d.width=parseInt(r[2],10)),2&d.valid&&4&d.valid)break}return 2&d.valid||n(3,"missing format specifier"),4&d.valid||n(3,"missing image size specifier"),d}(s),d=l.width,c=l.height,u=function(e,t,r){if(t<8||t>32767||2!==e[0]||2!==e[1]||128&e[2])return new Uint8Array(e);t!==(e[2]<<8|e[3])&&n(3,"wrong scanline width");let a=new Uint8Array(4*t*r);a.length||n(4,"unable to allocate buffer space");let o=0,i=0,s=4*t,l=new Uint8Array(4),d=new Uint8Array(s),c=r;for(;c>0&&i<e.byteLength;){i+4>e.byteLength&&n(1),l[0]=e[i++],l[1]=e[i++],l[2]=e[i++],l[3]=e[i++],(2!=l[0]||2!=l[1]||(l[2]<<8|l[3])!=t)&&n(3,"bad rgbe scanline format");let r=0,u;for(;r<s&&i<e.byteLength;){let t=(u=e[i++])>128;if(t&&(u-=128),(0===u||r+u>s)&&n(3,"bad scanline data"),t){let t=e[i++];for(let e=0;e<u;e++)d[r++]=t}else d.set(e.subarray(i,i+u),r),r+=u,i+=u}for(let e=0;e<t;e++){let r=0;a[o]=d[e+r],r+=t,a[o+1]=d[e+r],r+=t,a[o+2]=d[e+r],r+=t,a[o+3]=d[e+r],o+=4}c--}return a}(s.subarray(s.pos),d,c);switch(this.type){case r.FloatType:let h=new Float32Array(4*(o=u.length/4));for(let e=0;e<o;e++)!function(e,t,r,a){let o=Math.pow(2,e[t+3]-128)/255;r[a+0]=e[t+0]*o,r[a+1]=e[t+1]*o,r[a+2]=e[t+2]*o,r[a+3]=1}(u,4*e,h,4*e);t=h,a=r.FloatType;break;case r.HalfFloatType:let p=new Uint16Array(4*(o=u.length/4));for(let e=0;e<o;e++)!function(e,t,a,o){let n=Math.pow(2,e[t+3]-128)/255;a[o+0]=(0,r.DataUtils).toHalfFloat(Math.min(e[t+0]*n,65504)),a[o+1]=(0,r.DataUtils).toHalfFloat(Math.min(e[t+1]*n,65504)),a[o+2]=(0,r.DataUtils).toHalfFloat(Math.min(e[t+2]*n,65504)),a[o+3]=(0,r.DataUtils).toHalfFloat(1)}(u,4*e,p,4*e);t=p,a=r.HalfFloatType;break;default:throw Error("THREE.RGBELoader: Unsupported type: "+this.type)}return{width:d,height:c,data:t,header:l.string,gamma:l.gamma,exposure:l.exposure,type:a}}setDataType(e){return this.type=e,this}load(e,t,a,o){return super.load(e,function(e,a){switch(e.type){case r.FloatType:case r.HalfFloatType:e.colorSpace=r.LinearSRGBColorSpace,e.minFilter=r.LinearFilter,e.magFilter=r.LinearFilter,e.generateMipmaps=!1,e.flipY=!0}t&&t(e,a)},a,o)}}}),p("cE5k3",function(e,t){l(e.exports,"getScaledSettings",()=>r);function r(){let e=3,t=Math.max(1/window.devicePixelRatio,.5);return window.innerWidth/window.innerHeight<.65&&(e=4,t=.5/window.devicePixelRatio),{tiles:e,renderScale:t}}}),p("e2Pv4",function(e,t){let r;l(e.exports,"LoaderElement",()=>a);class a{constructor(){r||((r=document.createElement("style")).textContent=`

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
	`,document.head.appendChild(r));let e=document.createElement("div");e.classList.add("loader-container");let t=document.createElement("div");t.classList.add("percentage"),e.appendChild(t);let a=document.createElement("div");a.classList.add("samples"),e.appendChild(a);let o=document.createElement("div");o.classList.add("credits"),e.appendChild(o);let n=document.createElement("div");n.classList.add("bar"),e.appendChild(n);let i=document.createElement("div");i.classList.add("description"),e.appendChild(i),this._description=i,this._loaderBar=n,this._percentage=t,this._credits=o,this._samples=a,this._container=e,this.setPercentage(0)}attach(e){e.appendChild(this._container),e.appendChild(this._description)}setPercentage(e){this._loaderBar.style.width=`${100*e}%`,0===e?this._percentage.innerText="Loading...":this._percentage.innerText=`${(100*e).toFixed(0)}%`,e>=1?this._container.classList.remove("loading"):this._container.classList.add("loading")}setSamples(e,t=!1){t?this._samples.innerText="compiling shader...":this._samples.innerText=`${Math.floor(e)} samples`}setCredits(e){this._credits.innerHTML=e}setDescription(e){this._description.innerHTML=e}}}),p("kqOCM",function(e,t){l(e.exports,"ParallelMeshBVHWorker",()=>u);var r=h("ilwiq"),a=h("6KVZ3"),o=h("3ePKg"),n=h("cSOJe"),i=h("a8VBx"),s=h("5Gkg5");let d="undefined"!=typeof navigator?navigator.hardwareConcurrency:4;class c extends o.WorkerBase{constructor(){if(super(new Worker(h("2tQrc"))),this.name="ParallelMeshBVHWorker",this.maxWorkerCount=Math.max(d,4),!(0,n.isSharedArrayBufferSupported)())throw Error("ParallelMeshBVHWorker: Shared Array Buffers are not supported.")}runTask(e,t,o={}){return new Promise((i,l)=>{if(t.index||o.indirect||(0,s.ensureIndex)(t,o),t.getAttribute("position").isInterleavedBufferAttribute||t.index&&t.index.isInterleavedBufferAttribute)throw Error("ParallelMeshBVHWorker: InterleavedBufferAttribute are not supported for the geometry attributes.");e.onerror=e=>{l(Error(`ParallelMeshBVHWorker: ${e.message}`))},e.onmessage=n=>{let{data:s}=n;if(s.error)l(Error(s.error)),e.onmessage=null;else if(s.serialized){let{serialized:n,position:l}=s,d=(0,a.MeshBVH).deserialize(n,t,{setIndex:!1}),c={setBoundingBox:!0,...o};if(t.attributes.position.array=l,n.index){if(t.index)t.index.array=n.index;else{let e=new r.BufferAttribute(n.index,1,!1);t.setIndex(e)}}c.setBoundingBox&&(t.boundingBox=d.getBoundingBox(new r.Box3)),o.onProgress&&o.onProgress(s.progress),i(d),e.onmessage=null}else o.onProgress&&o.onProgress(s.progress)};let d=t.index?t.index.array:null,c=t.attributes.position.array;e.postMessage({operation:"BUILD_BVH",maxWorkerCount:this.maxWorkerCount,index:(0,n.convertToBufferType)(d,SharedArrayBuffer),position:(0,n.convertToBufferType)(c,SharedArrayBuffer),options:{...o,onProgress:null,includedProgressCallback:!!o.onProgress,groups:[...t.groups]}})})}}class u{constructor(){if((0,n.isSharedArrayBufferSupported)())return new c;{console.warn("ParallelMeshBVHWorker: SharedArrayBuffers not supported. Falling back to single-threaded GenerateMeshBVHWorker.");let e=new i.GenerateMeshBVHWorker;return e.maxWorkerCount=d,e}}}}),p("3ePKg",function(e,t){l(e.exports,"WorkerBase",()=>r);class r{constructor(e){this.name="WorkerBase",this.running=!1,this.worker=e,this.worker.onerror=e=>{if(e.message)throw Error(`${this.name}: Could not create Web Worker with error "${e.message}"`);throw Error(`${this.name}: Could not create Web Worker.`)}}runTask(){}generate(...e){if(this.running)throw Error("GenerateMeshBVHWorker: Already running job.");if(null===this.worker)throw Error("GenerateMeshBVHWorker: Worker has been disposed.");this.running=!0;let t=this.runTask(this.worker,...e);return t.finally(()=>{this.running=!1}),t}dispose(){this.worker.terminate(),this.worker=null}}}),p("a8VBx",function(e,t){l(e.exports,"GenerateMeshBVHWorker",()=>n);var r=h("ilwiq"),a=h("6KVZ3"),o=h("3ePKg");class n extends o.WorkerBase{constructor(){super(new Worker(h("jVRlM"))),this.name="GenerateMeshBVHWorker"}runTask(e,t,o={}){return new Promise((n,i)=>{if(t.getAttribute("position").isInterleavedBufferAttribute||t.index&&t.index.isInterleavedBufferAttribute)throw Error("GenerateMeshBVHWorker: InterleavedBufferAttribute are not supported for the geometry attributes.");e.onerror=e=>{i(Error(`GenerateMeshBVHWorker: ${e.message}`))},e.onmessage=s=>{let{data:l}=s;if(l.error)i(Error(l.error)),e.onmessage=null;else if(l.serialized){let{serialized:i,position:s}=l,d=(0,a.MeshBVH).deserialize(i,t,{setIndex:!1}),c=Object.assign({setBoundingBox:!0},o);if(t.attributes.position.array=s,i.index){if(t.index)t.index.array=i.index;else{let e=new r.BufferAttribute(i.index,1,!1);t.setIndex(e)}}c.setBoundingBox&&(t.boundingBox=d.getBoundingBox(new r.Box3)),o.onProgress&&o.onProgress(l.progress),n(d),e.onmessage=null}else o.onProgress&&o.onProgress(l.progress)};let s=t.index?t.index.array:null,l=t.attributes.position.array,d=[l];s&&d.push(s),e.postMessage({index:s,position:l,options:{...o,onProgress:null,includedProgressCallback:!!o.onProgress,groups:[...t.groups]}},d.map(e=>e.buffer).filter(e=>"undefined"==typeof SharedArrayBuffer||!(e instanceof SharedArrayBuffer)))})}}}),p("jVRlM",function(e,t){var r=h("7ryUf");let a=new URL("generateMeshBVH.worker.373f3c58.js",import.meta.url);e.exports=r(a.toString(),a.origin,!0)}),p("7ryUf",function(e,t){e.exports=function(e,t,r){if(t===self.location.origin)return e;var a=r?"import "+JSON.stringify(e)+";":"importScripts("+JSON.stringify(e)+");";return URL.createObjectURL(new Blob([a],{type:"application/javascript"}))}}),p("2tQrc",function(e,t){var r=h("7ryUf");let a=new URL("parallelMeshBVH.worker.22cf4bb0.js",import.meta.url);e.exports=r(a.toString(),a.origin,!0)}),p("9fZ6X",function(e,t){l(e.exports,"MaterialBase",()=>a);var r=h("ilwiq");class a extends r.ShaderMaterial{set needsUpdate(e){super.needsUpdate=!0,this.dispatchEvent({type:"recompilation"})}constructor(e){for(let t in super(e),this.uniforms)Object.defineProperty(this,t,{get(){return this.uniforms[t].value},set(e){this.uniforms[t].value=e}})}setDefine(e,t){if(null==t){if(e in this.defines)return delete this.defines[e],this.needsUpdate=!0,!0}else if(this.defines[e]!==t)return this.defines[e]=t,this.needsUpdate=!0,!0;return!1}}}),p("fYvb1",function(e,t){l(e.exports,"math_functions",()=>r);let r=`

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

`}),p("dUUQZ",function(e,t){l(e.exports,"util_functions",()=>r);let r=`

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
`}),p("8keuf",function(e,t){l(e.exports,"ggx_functions",()=>r);let r=`

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

`}),h("27Lyk").register(new URL("",import.meta.url).toString(),JSON.parse('["bmGh7","spotLights.9590d5be.js","512E4","parallelMeshBVH.worker.22cf4bb0.js","9P1cE","generateMeshBVH.worker.cd4b9fc6.js","lWWke","generateMeshBVH.worker.373f3c58.js","9P1cE","generateMeshBVH.worker.cd4b9fc6.js","jwbL2","aoRender.e5303912.js","bjWyA","aoRender.d33f21b3.js","2tzBs","aoRender.89c1b67b.js","6UuCC","aoRender.5fc59dbe.js","6mMEU","aoRender.fc8349f1.js","j19h5","aoRender.e8b1599c.js","5lTJX","areaLight.1c24b9b9.js","eL2Kp","areaLight.2aa801de.js"]'));var m=(h("ilwiq"),h("ilwiq"));class f extends m.Loader{constructor(e){super(e),this.type=m.HalfFloatType}_getIESValues(e,t){let r=Array(64800),a=e.horAngles[0],o=e.horAngles[e.numHorAngles-1];for(let t=0;t<64800;++t){let n=t%360,i=Math.floor(t/360);o-a!=0&&(n<a||n>=o)&&(n%=2*o)>o&&(n=2*o-n),r[i+180*n]=function(t,r){let a=0,o=0,n=0,i=0,s=0,l=0;for(let t=0;t<e.numHorAngles-1;++t)if(r<e.horAngles[t+1]||t==e.numHorAngles-2){o=t,n=e.horAngles[t],i=e.horAngles[t+1];break}for(let r=0;r<e.numVerAngles-1;++r)if(t<e.verAngles[r+1]||r==e.numVerAngles-2){a=r,s=e.verAngles[r],l=e.verAngles[r+1];break}let d=i-n,c=l-s;if(0===c)return 0;let u=0===d?0:(r-n)/d,h=(t-s)/c,p=0===d?o:o+1,f=(0,m.MathUtils).lerp(e.candelaValues[o][a],e.candelaValues[p][a],u),g=(0,m.MathUtils).lerp(e.candelaValues[o][a+1],e.candelaValues[p][a+1],u);return(0,m.MathUtils).lerp(f,g,h)}(i,n)}let n=null;return t===m.UnsignedByteType?n=Uint8Array.from(r.map(e=>Math.min(255*e,255))):t===m.HalfFloatType?n=Uint16Array.from(r.map(e=>(0,m.DataUtils).toHalfFloat(e))):t===m.FloatType?n=Float32Array.from(r):console.error("IESLoader: Unsupported type:",t),n}load(e,t,r,a){let o=new m.FileLoader(this.manager);o.setResponseType("text"),o.setCrossOrigin(this.crossOrigin),o.setWithCredentials(this.withCredentials),o.setPath(this.path),o.setRequestHeader(this.requestHeader),o.load(e,e=>{t(this.parse(e))},r,a)}parse(e){let t=this.type,r=new g(e),a=this._getIESValues(r,t),o=new m.DataTexture(a,180,1,m.RedFormat,t);return o.minFilter=m.LinearFilter,o.magFilter=m.LinearFilter,o.needsUpdate=!0,o}}function g(e){let t;let r=this,a=e.split("\n"),o=0;function n(e){return(e=(e=(e=e.replace(/^\s+|\s+$/g,"")).replace(/,/g," ")).replace(/\s\s+/g," ")).split(" ")}function i(e,t){for(;;){let r=n(a[o++]);for(let e=0;e<r.length;++e)t.push(Number(r[e]));if(t.length===e)break}}for(r.verAngles=[],r.horAngles=[],r.candelaValues=[],r.tiltData={},r.tiltData.angles=[],r.tiltData.mulFactors=[];!(t=a[o++]).includes("TILT"););if(!t.includes("NONE")&&t.includes("INCLUDE")){let e;e=n(a[o++]),r.tiltData.lampToLumGeometry=Number(e[0]),e=n(a[o++]),r.tiltData.numAngles=Number(e[0]),i(r.tiltData.numAngles,r.tiltData.angles),i(r.tiltData.numAngles,r.tiltData.mulFactors)}!function(){let e=[];i(10,e),r.count=Number(e[0]),r.lumens=Number(e[1]),r.multiplier=Number(e[2]),r.numVerAngles=Number(e[3]),r.numHorAngles=Number(e[4]),r.gonioType=Number(e[5]),r.units=Number(e[6]),r.width=Number(e[7]),r.length=Number(e[8]),r.height=Number(e[9])}(),function(){let e=[];i(3,e),r.ballFactor=Number(e[0]),r.blpFactor=Number(e[1]),r.inputWatts=Number(e[2])}();for(let e=0;e<r.numHorAngles;++e)r.candelaValues.push([]);i(r.numVerAngles,r.verAngles),i(r.numHorAngles,r.horAngles);for(let e=0;e<r.numHorAngles;++e)i(r.numVerAngles,r.candelaValues[e]);for(let e=0;e<r.numHorAngles;++e)for(let t=0;t<r.numVerAngles;++t)r.candelaValues[e][t]*=r.candelaValues[e][t]*r.multiplier*r.ballFactor*r.blpFactor;let s=-1;for(let e=0;e<r.numHorAngles;++e)for(let t=0;t<r.numVerAngles;++t){let a=r.candelaValues[e][t];s=s<a?a:s}if(s>0)for(let e=0;e<r.numHorAngles;++e)for(let t=0;t<r.numVerAngles;++t)r.candelaValues[e][t]/=s}var b=h("7lx9d"),w=h("5Rd1x"),v=h("d4kES"),y=h("8mHfG"),x=h("891vQ"),S=h("jiuw3"),k=h("cE5k3"),B=h("e2Pv4"),T=h("kqOCM");const P=["https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/0646706b3d2d9658994fc4ad80681dec.ies","https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/06b4cfdc8805709e767b5e2e904be8ad.ies","https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/007cfb11e343e2f42e3b476be4ab684e.ies","https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/01dac7d6c646814dcda6780e7b7b4566.ies","https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/108b32f07d6d38a7a6528a6d307440df.ies","https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/1aec5958092c236d005093ca27ebe378.ies","https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/02a7562c650498ebb301153dbbf59207.ies","https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/1a936937a49c63374e6d4fbed9252b29.ies","https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/ies/00c6ce79e1d2cdf3a1fb491aaaa47ae0.ies"],A={multipleImportanceSampling:!0,bounces:3,renderScale:1/window.devicePixelRatio,tiles:2,iesProfile:-1,...(0,k.getScaledSettings)()};function E(){t.setSize(window.innerWidth,window.innerHeight),t.setPixelRatio(window.devicePixelRatio*A.renderScale),o.aspect=window.innerWidth/window.innerHeight,o.updateProjectionMatrix(),e.updateCamera()}function M(){e.multipleImportanceSampling=A.multipleImportanceSampling,e.bounces=A.bounces,e.updateLights()}!async function(){(s=new B.LoaderElement).attach(document.body),(t=new m.WebGLRenderer).shadowMap.enabled=!0,t.physicallyCorrectLights=!0,t.shadowMap.type=m.PCFSoftShadowMap,t.toneMapping=m.ACESFilmicToneMapping,document.body.appendChild(t.domElement),(e=new y.WebGLPathTracer(t)).setBVHWorker(new T.ParallelMeshBVHWorker),e.tiles.set(A.tiles,A.tiles),e.textureSize.set(2048,2048),e.filterGlossyFactor=.5;let l=window.innerWidth/window.innerHeight;(o=new m.PerspectiveCamera(75,l,.025,500)).position.set(-2,4,8).multiplyScalar(.8),(r=new w.OrbitControls(o,t.domElement)).target.y=1.5,r.update(),r.addEventListener("change",()=>e.updateCamera()),(a=new m.Scene).backgroundBlurriness=.1,a.environmentIntensity=.1,a.backgroundIntensity=.1;let d=new f,[c,u,h]=await Promise.all([new(0,x.RGBELoader)().loadAsync("https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr"),new(0,b.GLTFLoader)().loadAsync("https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/steampunk-robot/scene.gltf"),Promise.all(P.map(e=>d.loadAsync(e)))]);i=h,c.mapping=m.EquirectangularReflectionMapping,a.environment=c,a.background=c,u.scene.scale.setScalar(1),u.scene.updateMatrixWorld(),u.scene.traverse(e=>{e.castShadow=!0,e.receiveShadow=!0}),a.add(u.scene);let p=new m.Box3;p.setFromObject(u.scene);let g=new m.Mesh(new m.CylinderGeometry(8,8,.5,200),new m.MeshStandardMaterial({color:5592405,roughness:.05,metalness:.4}));g.geometry=g.geometry.toNonIndexed(),g.geometry.clearGroups(),g.position.y=p.min.y-.25,g.receiveShadow=!0,g.material.color.convertSRGBToLinear(),a.add(g);let k=new m.Mesh(new m.BoxGeometry(14,6,.5),new m.MeshStandardMaterial({color:10511460,roughness:.4,metalness:.1}));k.castShadow=!0,k.receiveShadow=!0,k.geometry=k.geometry.toNonIndexed(),k.geometry.clearGroups(),k.position.x=0,k.position.y=p.min.y+3,k.position.z=p.min.z-.5,k.material.color.convertSRGBToLinear(),a.add(k),(n=new v.PhysicalSpotLight(16777215)).position.set(0,7,4),n.angle=Math.PI/4.5,n.decay=0,n.penumbra=1,n.distance=0,n.intensity=50,n.radius=.5,n.shadow.mapSize.width=512,n.shadow.mapSize.height=512,n.shadow.camera.near=.1,n.shadow.camera.far=10,n.shadow.focus=1,n.castShadow=!0,a.add(n);let L=n.target;L.position.x=0,L.position.y=g.position.y+2,L.position.z=.05,a.add(L),await e.setSceneAsync(a,o,{onProgress:e=>s.setPercentage(e)}),s.setCredits("Model by Benedict Chew on Sketchfab"),M(),E(),window.addEventListener("resize",E);let V=new S.GUI,C=V.addFolder("Path Tracing");C.add(A,"multipleImportanceSampling").onChange(M),C.add(A,"tiles",1,4,1).onChange(t=>{e.tiles.set(t,t)}),C.add(A,"bounces",1,30,1).onChange(M),C.add(A,"renderScale",.1,1).onChange(E);let F=V.addFolder("Spot Light");F.addColor(n,"color").onChange(M),F.add(n,"intensity",0,200,.01).onChange(M),F.add(n,"radius",0,10).onChange(M),F.add(n,"decay",0,2).onChange(M),F.add(n,"distance",0,20).onChange(M),F.add(n,"angle",0,Math.PI/2).onChange(M),F.add(n,"penumbra",0,1).onChange(M),F.add(A,"iesProfile",-1,P.length-1,1).onChange(e=>{n.iesMap=-1===e?null:i[e],M()}),function t(){requestAnimationFrame(t),o.updateMatrixWorld(),e.renderSample(),s.setSamples(e.samples,e.isCompiling)}()}();
//# sourceMappingURL=spotLights.9590d5be.js.map
