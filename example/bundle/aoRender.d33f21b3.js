function e(e,t,r,n){Object.defineProperty(e,t,{get:r,set:n,enumerable:!0,configurable:!0})}function t(e,t){return Object.keys(t).forEach(function(r){"default"===r||"__esModule"===r||Object.prototype.hasOwnProperty.call(e,r)||Object.defineProperty(e,r,{enumerable:!0,get:function(){return t[r]}})}),e}var r=globalThis,n={},i={},o=r.parcelRequire5b70;null==o&&((o=function(e){if(e in n)return n[e].exports;if(e in i){var t=i[e];delete i[e];var r={id:e,exports:{}};return n[e]=r,t.call(r.exports,r,r.exports),r.exports}var o=Error("Cannot find module '"+e+"'");throw o.code="MODULE_NOT_FOUND",o}).register=function(e,t){i[e]=t},r.parcelRequire5b70=o);var s=o.register;s("RPVlj",function(t,r){e(t.exports,"FullScreenQuad",()=>l);var n=o("ilwiq");let i=new n.OrthographicCamera(-1,1,1,-1,0,1);class s extends n.BufferGeometry{constructor(){super(),this.setAttribute("position",new n.Float32BufferAttribute([-1,3,0,-1,-1,0,3,-1,0],3)),this.setAttribute("uv",new n.Float32BufferAttribute([0,2,0,0,2,0],2))}}let a=new s;class l{constructor(e){this._mesh=new n.Mesh(a,e)}dispose(){this._mesh.geometry.dispose()}render(e){e.render(this._mesh,i)}get material(){return this._mesh.material}set material(e){this._mesh.material=e}}}),s("hWj76",function(t,r){e(t.exports,"PathTracingSceneGenerator",()=>u);var n=o("ilwiq"),i=o("6KVZ3"),s=o("alNGj"),a=o("dCCOj"),l=o("8LUnK");class u{get initialized(){return!!this.bvh}constructor(e){this.bvhOptions={},this.attributes=["position","normal","tangent","color","uv","uv2"],this.generateBVH=!0,this.bvh=null,this.geometry=new n.BufferGeometry,this.staticGeometryGenerator=new a.StaticGeometryGenerator(e),this._bvhWorker=null,this._pendingGenerate=null,this._buildAsync=!1,this._materialUuids=null}setObjects(e){this.staticGeometryGenerator.setObjects(e)}setBVHWorker(e){this._bvhWorker=e}async generateAsync(e=null){if(!this._bvhWorker)throw Error('PathTracingSceneGenerator: "setBVHWorker" must be called before "generateAsync" can be called.');if(this.bvh instanceof Promise)return this._pendingGenerate||(this._pendingGenerate=new Promise(async()=>(await this.bvh,this._pendingGenerate=null,this.generateAsync(e)))),this._pendingGenerate;{this._buildAsync=!0;let t=this.generate(e);return this._buildAsync=!1,t.bvh=this.bvh=await t.bvh,t}}generate(e=null){let{staticGeometryGenerator:t,geometry:r,attributes:n}=this,o=t.objects;t.attributes=n,o.forEach(e=>{e.traverse(e=>{e.isSkinnedMesh&&e.skeleton&&e.skeleton.update()})});let u=t.generate(r),c=u.materials,d=u.changeType!==a.NO_CHANGE||null===this._materialUuids||this._materialUuids.length!==length;if(!d){for(let e=0,t=c.length;e<t;e++)if(c[e].uuid!==this._materialUuids[e]){d=!0;break}}let f=function(e){let t=new Set;for(let r=0,n=e.length;r<n;r++){let n=e[r];for(let e in n){let r=n[e];r&&r.isTexture&&t.add(r)}}return Array.from(t)}(c),{lights:p,iesTextures:h}=function(e){let t=[],r=new Set;for(let n=0,i=e.length;n<i;n++)e[n].traverse(e=>{e.visible&&(e.isRectAreaLight||e.isSpotLight||e.isPointLight||e.isDirectionalLight)&&(t.push(e),e.iesMap&&r.add(e.iesMap))});return{lights:t,iesTextures:Array.from(r).sort((e,t)=>e.uuid<t.uuid?1:e.uuid>t.uuid?-1:0)}}(o);if(d&&((0,l.updateMaterialIndexAttribute)(r,c,c),this._materialUuids=c.map(e=>e.uuid)),this.generateBVH){if(this.bvh instanceof Promise)throw Error("PathTracingSceneGenerator: BVH is already building asynchronously.");if(u.changeType===a.GEOMETRY_REBUILT){let t={strategy:s.SAH,maxLeafTris:1,indirect:!0,onProgress:e,...this.bvhOptions};this._buildAsync?this.bvh=this._bvhWorker.generate(r,t):this.bvh=new i.MeshBVH(r,t)}else u.changeType===a.GEOMETRY_ADJUSTED&&this.bvh.refit()}return{bvhChanged:u.changeType!==a.NO_CHANGE,bvh:this.bvh,needsMaterialIndexUpdate:d,lights:p,iesTextures:h,geometry:r,materials:c,textures:f,objects:o}}}}),s("6KVZ3",function(t,r){e(t.exports,"MeshBVH",()=>D);var n=o("ilwiq"),i=o("alNGj"),s=o("knbvI"),a=o("lenTA"),l=o("eADNI"),u=o("7EZfU"),c=o("8hs00"),d=o("8VlEg"),f=o("9Kyri"),p=o("ayHng"),h=o("laUNa"),m=o("1SnJR"),x=o("dhXUU"),g=o("dnRHH"),y=o("gDpfV"),v=o("iERXt"),T=o("kNP8c"),b=o("ZxvHI"),A=o("bD1WL"),B=o("gUrAj"),w=o("cSOJe"),I=o("dRxiJ"),_=o("f1zUR");let E=new a.OrientedBox,S=new n.Box3,M={strategy:i.CENTER,maxDepth:40,maxLeafTris:10,useSharedArrayBuffer:!1,setBoundingBox:!0,onProgress:null,indirect:!1,verbose:!0};class D{static serialize(e,t={}){t={cloneBuffers:!0,...t};let r=e.geometry,n=e._roots,i=e._indirectBuffer,o=r.getIndex();return t.cloneBuffers?{roots:n.map(e=>e.slice()),index:o?o.array.slice():null,indirectBuffer:i?i.slice():null}:{roots:n,index:o?o.array:null,indirectBuffer:i}}static deserialize(e,t,r={}){r={setIndex:!0,indirect:!!e.indirectBuffer,...r};let{index:o,roots:s,indirectBuffer:a}=e,l=new D(t,{...r,[i.SKIP_GENERATION]:!0});if(l._roots=s,l._indirectBuffer=a||null,r.setIndex){let r=t.getIndex();if(null===r){let r=new n.BufferAttribute(e.index,1,!1);t.setIndex(r)}else r.array!==o&&(r.array.set(o),r.needsUpdate=!0)}return l}get indirect(){return!!this._indirectBuffer}constructor(e,t={}){if(e.isBufferGeometry){if(e.index&&e.index.isInterleavedBufferAttribute)throw Error("MeshBVH: InterleavedBufferAttribute is not supported for the index attribute.")}else throw Error("MeshBVH: Only BufferGeometries are supported.");if((t=Object.assign({...M,[i.SKIP_GENERATION]:!1},t)).useSharedArrayBuffer&&!(0,w.isSharedArrayBufferSupported)())throw Error("MeshBVH: SharedArrayBuffer is not available.");this.geometry=e,this._roots=null,this._indirectBuffer=null,t[i.SKIP_GENERATION]||((0,s.buildPackedTree)(this,t),!e.boundingBox&&t.setBoundingBox&&(e.boundingBox=this.getBoundingBox(new n.Box3)));let{_indirectBuffer:r}=this;this.resolveTriangleIndex=t.indirect?e=>r[e]:e=>e}refit(e=null){return(this.indirect?v.refit_indirect:p.refit)(this,e)}traverse(e,t=0){let r=this._roots[t],n=new Uint32Array(r),o=new Uint16Array(r);(function t(s,a=0){let l=2*s,u=o[l+15]===i.IS_LEAFNODE_FLAG;if(u){let t=n[s+6],i=o[l+14];e(a,u,new Float32Array(r,4*s,6),t,i)}else{let o=s+i.BYTES_PER_NODE/4,l=n[s+6],c=n[s+7];e(a,u,new Float32Array(r,4*s,6),c)||(t(o,a+1),t(l,a+1))}})(0)}raycast(e,t=n.FrontSide){let r=this._roots,i=this.geometry,o=[],s=t.isMaterial,a=Array.isArray(t),l=i.groups,u=s?t.side:t,c=this.indirect?T.raycast_indirect:h.raycast;for(let n=0,i=r.length;n<i;n++){let r=a?t[l[n].materialIndex].side:u,i=o.length;if(c(this,n,r,e,o),a){let e=l[n].materialIndex;for(let t=i,r=o.length;t<r;t++)o[t].face.materialIndex=e}}return o}raycastFirst(e,t=n.FrontSide){let r=this._roots,i=this.geometry,o=t.isMaterial,s=Array.isArray(t),a=null,l=i.groups,u=o?t.side:t,c=this.indirect?b.raycastFirst_indirect:m.raycastFirst;for(let n=0,i=r.length;n<i;n++){let r=s?t[l[n].materialIndex].side:u,i=c(this,n,r,e);null!=i&&(null==a||i.distance<a.distance)&&(a=i,s&&(i.face.materialIndex=l[n].materialIndex))}return a}intersectsGeometry(e,t){let r=!1,n=this._roots,i=this.indirect?A.intersectsGeometry_indirect:x.intersectsGeometry;for(let o=0,s=n.length;o<s&&!(r=i(this,o,e,t));o++);return r}shapecast(e){let t=(0,u.ExtendedTrianglePool).getPrimitive(),r=this.indirect?y.iterateOverTriangles_indirect:f.iterateOverTriangles,{boundsTraverseOrder:n,intersectsBounds:i,intersectsRange:o,intersectsTriangle:s}=e;if(o&&s){let e=o;o=(n,i,o,a,l)=>!!e(n,i,o,a,l)||r(n,i,this,s,o,a,t)}else o||(o=s?(e,n,i,o)=>r(e,n,this,s,i,o,t):(e,t,r)=>r);let a=!1,l=0,d=this._roots;for(let e=0,t=d.length;e<t;e++){let t=d[e];if(a=(0,c.shapecast)(this,e,i,o,n,l))break;l+=t.byteLength}return(0,u.ExtendedTrianglePool).releasePrimitive(t),a}bvhcast(e,t,r){let{intersectsRanges:n,intersectsTriangles:i}=r,o=(0,u.ExtendedTrianglePool).getPrimitive(),s=this.geometry.index,a=this.geometry.attributes.position,l=this.indirect?e=>{let t=this.resolveTriangleIndex(e);(0,I.setTriangle)(o,3*t,s,a)}:e=>{(0,I.setTriangle)(o,3*e,s,a)},c=(0,u.ExtendedTrianglePool).getPrimitive(),d=e.geometry.index,f=e.geometry.attributes.position,p=e.indirect?t=>{let r=e.resolveTriangleIndex(t);(0,I.setTriangle)(c,3*r,d,f)}:e=>{(0,I.setTriangle)(c,3*e,d,f)};if(i){let e=(e,r,n,s,a,u,d,f)=>{for(let h=n,m=n+s;h<m;h++){p(h),c.a.applyMatrix4(t),c.b.applyMatrix4(t),c.c.applyMatrix4(t),c.needsUpdate=!0;for(let t=e,n=e+r;t<n;t++)if(l(t),o.needsUpdate=!0,i(o,c,t,h,a,u,d,f))return!0}return!1};if(n){let t=n;n=function(r,n,i,o,s,a,l,u){return!!t(r,n,i,o,s,a,l,u)||e(r,n,i,o,s,a,l,u)}}else n=e}return(0,_.bvhcast)(this,e,t,n)}intersectsBox(e,t){return E.set(e.min,e.max,t),E.needsUpdate=!0,this.shapecast({intersectsBounds:e=>E.intersectsBox(e),intersectsTriangle:e=>E.intersectsTriangle(e)})}intersectsSphere(e){return this.shapecast({intersectsBounds:t=>e.intersectsBox(t),intersectsTriangle:t=>t.intersectsSphere(e)})}closestPointToGeometry(e,t,r={},n={},i=0,o=1/0){return(this.indirect?B.closestPointToGeometry_indirect:g.closestPointToGeometry)(this,e,t,r,n,i,o)}closestPointToPoint(e,t={},r=0,n=1/0){return(0,d.closestPointToPoint)(this,e,t,r,n)}getBoundingBox(e){return e.makeEmpty(),this._roots.forEach(t=>{(0,l.arrayToBox)(0,new Float32Array(t),S),e.union(S)}),e}}}),s("alNGj",function(t,r){e(t.exports,"CENTER",()=>n),e(t.exports,"AVERAGE",()=>i),e(t.exports,"SAH",()=>o),e(t.exports,"CONTAINED",()=>s),e(t.exports,"TRIANGLE_INTERSECT_COST",()=>a),e(t.exports,"TRAVERSAL_COST",()=>l),e(t.exports,"BYTES_PER_NODE",()=>u),e(t.exports,"IS_LEAFNODE_FLAG",()=>c),e(t.exports,"FLOAT32_EPSILON",()=>d),e(t.exports,"SKIP_GENERATION",()=>f);let n=0,i=1,o=2,s=2,a=1.25,l=1,u=32,c=65535,d=5960464477539063e-23,f=Symbol("SKIP_GENERATION")}),s("knbvI",function(t,r){e(t.exports,"buildPackedTree",()=>f);var n=o("5Gkg5"),i=o("6zZ33"),s=o("4rNvL"),a=o("O2f62"),l=o("alNGj"),u=o("8aRzr"),c=o("fe03E"),d=o("8yQ90");function f(e,t){let r=e.geometry;t.indirect&&(e._indirectBuffer=function(e,t){let r=(e.index?e.index.count:e.attributes.position.count)/3,n=r>65536,i=n?4:2,o=t?new SharedArrayBuffer(r*i):new ArrayBuffer(r*i),s=n?new Uint32Array(o):new Uint16Array(o);for(let e=0,t=s.length;e<t;e++)s[e]=e;return s}(r,t.useSharedArrayBuffer),(0,n.hasGroupGaps)(r)&&!t.verbose&&console.warn('MeshBVH: Provided geometry contains groups that do not fully span the vertex contents while using the "indirect" option. BVH may incorrectly report intersections on unrendered portions of the geometry.')),e._indirectBuffer||(0,n.ensureIndex)(r,t);let o=t.useSharedArrayBuffer?SharedArrayBuffer:ArrayBuffer,f=(0,i.computeTriangleBounds)(r),p=t.indirect?(0,n.getFullGeometryRange)(r):(0,n.getRootIndexRanges)(r);e._roots=p.map(r=>{let p=function(e,t,r,o,l){let{maxDepth:d,verbose:f,maxLeafTris:p,strategy:h,onProgress:m,indirect:x}=l,g=e._indirectBuffer,y=e.geometry,v=y.index?y.index.array:null,T=x?c.partition_indirect:u.partition,b=(0,n.getTriCount)(y),A=new Float32Array(6),B=!1,w=new a.MeshBVHNode;return(0,i.getBounds)(t,r,o,w.boundingData,A),function e(r,n,o,l=null,u=0){if(!B&&u>=d&&(B=!0,f&&(console.warn(`MeshBVH: Max depth of ${d} reached when generating BVH. Consider increasing maxDepth.`),console.warn(y))),o<=p||u>=d)return I(n+o),r.offset=n,r.count=o,r;let c=(0,s.getOptimalSplit)(r.boundingData,l,t,n,o,h);if(-1===c.axis)return I(n+o),r.offset=n,r.count=o,r;let m=T(g,v,t,n,o,c);if(m===n||m===n+o)I(n+o),r.offset=n,r.count=o;else{r.splitAxis=c.axis;let s=new a.MeshBVHNode,l=m-n;r.left=s,(0,i.getBounds)(t,n,l,s.boundingData,A),e(s,n,l,A,u+1);let d=new a.MeshBVHNode,f=o-l;r.right=d,(0,i.getBounds)(t,m,f,d.boundingData,A),e(d,m,f,A,u+1)}return r}(w,r,o,A),w;function I(e){m&&m(e/b)}}(e,f,r.offset,r.count,t),h=(0,d.countNodes)(p),m=new o(l.BYTES_PER_NODE*h);return(0,d.populateBuffer)(0,p,m),m})}}),s("5Gkg5",function(t,r){e(t.exports,"getVertexCount",()=>i),e(t.exports,"getTriCount",()=>s),e(t.exports,"getIndexArray",()=>a),e(t.exports,"ensureIndex",()=>l),e(t.exports,"getFullGeometryRange",()=>u),e(t.exports,"getRootIndexRanges",()=>c),e(t.exports,"hasGroupGaps",()=>d);var n=o("ilwiq");function i(e){return e.index?e.index.count:e.attributes.position.count}function s(e){return i(e)/3}function a(e,t=ArrayBuffer){return e>65535?new Uint32Array(new t(4*e)):new Uint16Array(new t(2*e))}function l(e,t){if(!e.index){let r=e.attributes.position.count,i=a(r,t.useSharedArrayBuffer?SharedArrayBuffer:ArrayBuffer);e.setIndex(new n.BufferAttribute(i,1));for(let e=0;e<r;e++)i[e]=e}}function u(e){let t=s(e),r=e.drawRange,n=r.start/3,i=(r.start+r.count)/3,o=Math.max(0,n);return[{offset:Math.floor(o),count:Math.floor(Math.min(t,i)-o)}]}function c(e){if(!e.groups||!e.groups.length)return u(e);let t=[],r=new Set,n=e.drawRange,i=n.start/3,o=(n.start+n.count)/3;for(let t of e.groups){let e=t.start/3,n=(t.start+t.count)/3;r.add(Math.max(i,e)),r.add(Math.min(o,n))}let s=Array.from(r.values()).sort((e,t)=>e-t);for(let e=0;e<s.length-1;e++){let r=s[e],n=s[e+1];t.push({offset:Math.floor(r),count:Math.floor(n-r)})}return t}function d(e){if(0===e.groups.length)return!1;let t=s(e),r=c(e).sort((e,t)=>e.offset-t.offset),n=r[r.length-1];n.count=Math.min(t-n.offset,n.count);let i=0;return r.forEach(({count:e})=>i+=e),t!==i}}),s("6zZ33",function(t,r){e(t.exports,"getBounds",()=>s),e(t.exports,"computeTriangleBounds",()=>a);var n=o("alNGj"),i=o("5Gkg5");function s(e,t,r,n,i){let o=1/0,s=1/0,a=1/0,l=-1/0,u=-1/0,c=-1/0,d=1/0,f=1/0,p=1/0,h=-1/0,m=-1/0,x=-1/0;for(let n=6*t,i=(t+r)*6;n<i;n+=6){let t=e[n+0],r=e[n+1],i=t-r,g=t+r;i<o&&(o=i),g>l&&(l=g),t<d&&(d=t),t>h&&(h=t);let y=e[n+2],v=e[n+3],T=y-v,b=y+v;T<s&&(s=T),b>u&&(u=b),y<f&&(f=y),y>m&&(m=y);let A=e[n+4],B=e[n+5],w=A-B,I=A+B;w<a&&(a=w),I>c&&(c=I),A<p&&(p=A),A>x&&(x=A)}n[0]=o,n[1]=s,n[2]=a,n[3]=l,n[4]=u,n[5]=c,i[0]=d,i[1]=f,i[2]=p,i[3]=h,i[4]=m,i[5]=x}function a(e,t=null,r=null,o=null){let s;let a=e.attributes.position,l=e.index?e.index.array:null,u=(0,i.getTriCount)(e),c=a.normalized;null===t?(s=new Float32Array(24*u),r=0,o=u):(s=t,r=r||0,o=o||u);let d=a.array,f=a.offset||0,p=3;a.isInterleavedBufferAttribute&&(p=a.data.stride);let h=["getX","getY","getZ"];for(let e=r;e<r+o;e++){let t=3*e,r=6*e,i=t+0,o=t+1,u=t+2;l&&(i=l[i],o=l[o],u=l[u]),c||(i=i*p+f,o=o*p+f,u=u*p+f);for(let e=0;e<3;e++){let t,l,f;c?(t=a[h[e]](i),l=a[h[e]](o),f=a[h[e]](u)):(t=d[i+e],l=d[o+e],f=d[u+e]);let p=t;l<p&&(p=l),f<p&&(p=f);let m=t;l>m&&(m=l),f>m&&(m=f);let x=(m-p)/2,g=2*e;s[r+g+0]=p+x,s[r+g+1]=x+(Math.abs(p)+x)*n.FLOAT32_EPSILON}}return s}}),s("4rNvL",function(t,r){e(t.exports,"getOptimalSplit",()=>u);var n=o("eADNI"),i=o("alNGj");let s=(e,t)=>e.candidate-t.candidate,a=Array(32).fill().map(()=>({count:0,bounds:new Float32Array(6),rightCacheBounds:new Float32Array(6),leftCacheBounds:new Float32Array(6),candidate:0})),l=new Float32Array(6);function u(e,t,r,o,u,c){let d=-1,f=0;if(c===i.CENTER)-1!==(d=(0,n.getLongestEdgeIndex)(t))&&(f=(t[d]+t[d+3])/2);else if(c===i.AVERAGE)-1!==(d=(0,n.getLongestEdgeIndex)(e))&&(f=function(e,t,r,n){let i=0;for(let o=t,s=t+r;o<s;o++)i+=e[6*o+2*n];return i/r}(r,o,u,d));else if(c===i.SAH){let c=(0,n.computeSurfaceArea)(e),p=i.TRIANGLE_INTERSECT_COST*u,h=6*o,m=(o+u)*6;for(let e=0;e<3;e++){let o=t[e],x=(t[e+3]-o)/32;if(u<8){let t=[...a];t.length=u;let o=0;for(let i=h;i<m;i+=6,o++){let s=t[o];s.candidate=r[i+2*e],s.count=0;let{bounds:a,leftCacheBounds:l,rightCacheBounds:u}=s;for(let e=0;e<3;e++)u[e]=1/0,u[e+3]=-1/0,l[e]=1/0,l[e+3]=-1/0,a[e]=1/0,a[e+3]=-1/0;(0,n.expandByTriangleBounds)(i,r,a)}t.sort(s);let l=u;for(let e=0;e<l;e++){let r=t[e];for(;e+1<l&&t[e+1].candidate===r.candidate;)t.splice(e+1,1),l--}for(let i=h;i<m;i+=6){let o=r[i+2*e];for(let e=0;e<l;e++){let s=t[e];o>=s.candidate?(0,n.expandByTriangleBounds)(i,r,s.rightCacheBounds):((0,n.expandByTriangleBounds)(i,r,s.leftCacheBounds),s.count++)}}for(let r=0;r<l;r++){let o=t[r],s=o.count,a=u-o.count,l=o.leftCacheBounds,h=o.rightCacheBounds,m=0;0!==s&&(m=(0,n.computeSurfaceArea)(l)/c);let x=0;0!==a&&(x=(0,n.computeSurfaceArea)(h)/c);let g=i.TRAVERSAL_COST+i.TRIANGLE_INTERSECT_COST*(m*s+x*a);g<p&&(d=e,p=g,f=o.candidate)}}else{for(let e=0;e<32;e++){let t=a[e];t.count=0,t.candidate=o+x+e*x;let r=t.bounds;for(let e=0;e<3;e++)r[e]=1/0,r[e+3]=-1/0}for(let t=h;t<m;t+=6){let i=~~((r[t+2*e]-o)/x);i>=32&&(i=31);let s=a[i];s.count++,(0,n.expandByTriangleBounds)(t,r,s.bounds)}let t=a[31];(0,n.copyBounds)(t.bounds,t.rightCacheBounds);for(let e=30;e>=0;e--){let t=a[e],r=a[e+1];(0,n.unionBounds)(t.bounds,r.rightCacheBounds,t.rightCacheBounds)}let s=0;for(let t=0;t<31;t++){let r=a[t],o=r.count,h=r.bounds,m=a[t+1].rightCacheBounds;0!==o&&(0===s?(0,n.copyBounds)(h,l):(0,n.unionBounds)(h,l,l));let x=0,g=0;0!==(s+=o)&&(x=(0,n.computeSurfaceArea)(l)/c);let y=u-s;0!==y&&(g=(0,n.computeSurfaceArea)(m)/c);let v=i.TRAVERSAL_COST+i.TRIANGLE_INTERSECT_COST*(x*s+g*y);v<p&&(d=e,p=v,f=r.candidate)}}}}else console.warn(`MeshBVH: Invalid build strategy value ${c} used.`);return{axis:d,pos:f}}}),s("eADNI",function(t,r){function n(e,t,r){return r.min.x=t[e],r.min.y=t[e+1],r.min.z=t[e+2],r.max.x=t[e+3],r.max.y=t[e+4],r.max.z=t[e+5],r}function i(e){let t=-1,r=-1/0;for(let n=0;n<3;n++){let i=e[n+3]-e[n];i>r&&(r=i,t=n)}return t}function o(e,t){t.set(e)}function s(e,t,r){let n,i;for(let o=0;o<3;o++){let s=o+3;n=e[o],i=t[o],r[o]=n<i?n:i,n=e[s],i=t[s],r[s]=n>i?n:i}}function a(e,t,r){for(let n=0;n<3;n++){let i=t[e+2*n],o=t[e+2*n+1],s=i-o,a=i+o;s<r[n]&&(r[n]=s),a>r[n+3]&&(r[n+3]=a)}}function l(e){let t=e[3]-e[0],r=e[4]-e[1],n=e[5]-e[2];return 2*(t*r+r*n+n*t)}e(t.exports,"arrayToBox",()=>n),e(t.exports,"getLongestEdgeIndex",()=>i),e(t.exports,"copyBounds",()=>o),e(t.exports,"unionBounds",()=>s),e(t.exports,"expandByTriangleBounds",()=>a),e(t.exports,"computeSurfaceArea",()=>l)}),s("O2f62",function(t,r){e(t.exports,"MeshBVHNode",()=>n);class n{constructor(){this.boundingData=new Float32Array(6)}}}),s("8aRzr",function(t,r){e(t.exports,"partition",()=>n);function n(e,t,r,n,i,o){let s=n,a=n+i-1,l=o.pos,u=2*o.axis;for(;;){for(;s<=a&&r[6*s+u]<l;)s++;for(;s<=a&&r[6*a+u]>=l;)a--;if(!(s<a))return s;for(let e=0;e<3;e++){let r=t[3*s+e];t[3*s+e]=t[3*a+e],t[3*a+e]=r}for(let e=0;e<6;e++){let t=r[6*s+e];r[6*s+e]=r[6*a+e],r[6*a+e]=t}s++,a--}}}),s("fe03E",function(t,r){e(t.exports,"partition_indirect",()=>n);function n(e,t,r,n,i,o){let s=n,a=n+i-1,l=o.pos,u=2*o.axis;for(;;){for(;s<=a&&r[6*s+u]<l;)s++;for(;s<=a&&r[6*a+u]>=l;)a--;if(!(s<a))return s;{let t=e[s];e[s]=e[a],e[a]=t;for(let e=0;e<6;e++){let t=r[6*s+e];r[6*s+e]=r[6*a+e],r[6*a+e]=t}s++,a--}}}}),s("8yQ90",function(t,r){let n,i,s,a;e(t.exports,"countNodes",()=>function e(t){return"count"in t?1:1+e(t.left)+e(t.right)}),e(t.exports,"populateBuffer",()=>c);var l=o("alNGj"),u=o("8x2iv");function c(e,t,r){return n=new Float32Array(r),i=new Uint32Array(r),s=new Uint16Array(r),a=new Uint8Array(r),function e(t,r){let o=t/4,c=t/2,d=r.boundingData;for(let e=0;e<6;e++)n[o+e]=d[e];if("count"in r){if(r.buffer){let e=r.buffer;a.set(new Uint8Array(e),t);for(let r=t,n=t+e.byteLength;r<n;r+=l.BYTES_PER_NODE){let e=r/2;(0,u.IS_LEAF)(e,s)||(i[r/4+6]+=o)}return t+e.byteLength}{let e=r.offset,n=r.count;return i[o+6]=e,s[c+14]=n,s[c+15]=l.IS_LEAFNODE_FLAG,t+l.BYTES_PER_NODE}}{let n;let s=r.left,a=r.right,u=r.splitAxis;if((n=e(t+l.BYTES_PER_NODE,s))/4>4294967296)throw Error("MeshBVH: Cannot store child pointer greater than 32 bits.");return i[o+6]=n/4,n=e(n,a),i[o+7]=u,n}}(e,t)}}),s("8x2iv",function(t,r){function n(e,t){return 65535===t[e+15]}function i(e,t){return t[e+6]}function o(e,t){return t[e+14]}function s(e){return e+8}function a(e,t){return t[e+6]}function l(e,t){return t[e+7]}function u(e){return e}e(t.exports,"IS_LEAF",()=>n),e(t.exports,"OFFSET",()=>i),e(t.exports,"COUNT",()=>o),e(t.exports,"LEFT_NODE",()=>s),e(t.exports,"RIGHT_NODE",()=>a),e(t.exports,"SPLIT_AXIS",()=>l),e(t.exports,"BOUNDING_DATA_INDEX",()=>u)}),s("lenTA",function(t,r){e(t.exports,"OrientedBox",()=>l);var n=o("ilwiq"),i=o("2OKGW"),s=o("8VYkb"),a=o("f56Km");class l{constructor(e,t,r){this.isOrientedBox=!0,this.min=new n.Vector3,this.max=new n.Vector3,this.matrix=new n.Matrix4,this.invMatrix=new n.Matrix4,this.points=Array(8).fill().map(()=>new n.Vector3),this.satAxes=[,,,].fill().map(()=>new n.Vector3),this.satBounds=[,,,].fill().map(()=>new i.SeparatingAxisBounds),this.alignedSatBounds=[,,,].fill().map(()=>new i.SeparatingAxisBounds),this.needsUpdate=!1,e&&this.min.copy(e),t&&this.max.copy(t),r&&this.matrix.copy(r)}set(e,t,r){this.min.copy(e),this.max.copy(t),this.matrix.copy(r),this.needsUpdate=!0}copy(e){this.min.copy(e.min),this.max.copy(e.max),this.matrix.copy(e.matrix),this.needsUpdate=!0}}l.prototype.update=function(){let e=this.matrix,t=this.min,r=this.max,n=this.points;for(let i=0;i<=1;i++)for(let o=0;o<=1;o++)for(let s=0;s<=1;s++){let a=n[1*i|2*o|4*s];a.x=i?r.x:t.x,a.y=o?r.y:t.y,a.z=s?r.z:t.z,a.applyMatrix4(e)}let i=this.satBounds,o=this.satAxes,s=n[0];for(let e=0;e<3;e++){let t=o[e],r=i[e],a=n[1<<e];t.subVectors(s,a),r.setFromPoints(t,n)}let a=this.alignedSatBounds;a[0].setFromPointsField(n,"x"),a[1].setFromPointsField(n,"y"),a[2].setFromPointsField(n,"z"),this.invMatrix.copy(this.matrix).invert(),this.needsUpdate=!1},l.prototype.intersectsBox=function(){let e=new i.SeparatingAxisBounds;return function(t){this.needsUpdate&&this.update();let r=t.min,n=t.max,i=this.satBounds,o=this.satAxes,s=this.alignedSatBounds;if(e.min=r.x,e.max=n.x,s[0].isSeparated(e)||(e.min=r.y,e.max=n.y,s[1].isSeparated(e))||(e.min=r.z,e.max=n.z,s[2].isSeparated(e)))return!1;for(let r=0;r<3;r++){let n=o[r],s=i[r];if(e.setFromBox(n,t),s.isSeparated(e))return!1}return!0}}(),l.prototype.intersectsTriangle=function(){let e=new s.ExtendedTriangle,t=[,,,],r=new i.SeparatingAxisBounds,o=new i.SeparatingAxisBounds,a=new n.Vector3;return function(n){this.needsUpdate&&this.update(),n.isExtendedTriangle?n.needsUpdate&&n.update():(e.copy(n),e.update(),n=e);let i=this.satBounds,s=this.satAxes;t[0]=n.a,t[1]=n.b,t[2]=n.c;for(let e=0;e<3;e++){let n=i[e],o=s[e];if(r.setFromPoints(o,t),n.isSeparated(r))return!1}let l=n.satBounds,u=n.satAxes,c=this.points;for(let e=0;e<3;e++){let t=l[e],n=u[e];if(r.setFromPoints(n,c),t.isSeparated(r))return!1}for(let e=0;e<3;e++){let n=s[e];for(let e=0;e<4;e++){let i=u[e];if(a.crossVectors(n,i),r.setFromPoints(a,t),o.setFromPoints(a,c),r.isSeparated(o))return!1}}return!0}}(),l.prototype.closestPointToPoint=function(e,t){return this.needsUpdate&&this.update(),t.copy(e).applyMatrix4(this.invMatrix).clamp(this.min,this.max).applyMatrix4(this.matrix),t},l.prototype.distanceToPoint=function(){let e=new n.Vector3;return function(t){return this.closestPointToPoint(t,e),t.distanceTo(e)}}(),l.prototype.distanceToBox=function(){let e=["x","y","z"],t=Array(12).fill().map(()=>new n.Line3),r=Array(12).fill().map(()=>new n.Line3),i=new n.Vector3,o=new n.Vector3;return function(n,s=0,l=null,u=null){if(this.needsUpdate&&this.update(),this.intersectsBox(n))return(l||u)&&(n.getCenter(o),this.closestPointToPoint(o,i),n.closestPointToPoint(i,o),l&&l.copy(i),u&&u.copy(o)),0;let c=s*s,d=n.min,f=n.max,p=this.points,h=1/0;for(let e=0;e<8;e++){let t=p[e];o.copy(t).clamp(d,f);let r=t.distanceToSquared(o);if(r<h&&(h=r,l&&l.copy(t),u&&u.copy(o),r<c))return Math.sqrt(r)}let m=0;for(let n=0;n<3;n++)for(let i=0;i<=1;i++)for(let o=0;o<=1;o++){let s=(n+1)%3,a=(n+2)%3,l=i<<s|o<<a,u=1<<n|i<<s|o<<a,c=p[l],h=p[u];t[m].set(c,h);let x=e[n],g=e[s],y=e[a],v=r[m],T=v.start,b=v.end;T[x]=d[x],T[g]=i?d[g]:f[g],T[y]=o?d[y]:f[g],b[x]=f[x],b[g]=i?d[g]:f[g],b[y]=o?d[y]:f[g],m++}for(let e=0;e<=1;e++)for(let t=0;t<=1;t++)for(let r=0;r<=1;r++){o.x=e?f.x:d.x,o.y=t?f.y:d.y,o.z=r?f.z:d.z,this.closestPointToPoint(o,i);let n=o.distanceToSquared(i);if(n<h&&(h=n,l&&l.copy(i),u&&u.copy(o),n<c))return Math.sqrt(n)}for(let e=0;e<12;e++){let n=t[e];for(let e=0;e<12;e++){let t=r[e];(0,a.closestPointsSegmentToSegment)(n,t,i,o);let s=i.distanceToSquared(o);if(s<h&&(h=s,l&&l.copy(i),u&&u.copy(o),s<c))return Math.sqrt(s)}}return Math.sqrt(h)}}()}),s("2OKGW",function(t,r){e(t.exports,"SeparatingAxisBounds",()=>i);var n=o("ilwiq");class i{constructor(){this.min=1/0,this.max=-1/0}setFromPointsField(e,t){let r=1/0,n=-1/0;for(let i=0,o=e.length;i<o;i++){let o=e[i][t];r=o<r?o:r,n=o>n?o:n}this.min=r,this.max=n}setFromPoints(e,t){let r=1/0,n=-1/0;for(let i=0,o=t.length;i<o;i++){let o=t[i],s=e.dot(o);r=s<r?s:r,n=s>n?s:n}this.min=r,this.max=n}isSeparated(e){return this.min>e.max||e.min>this.max}}i.prototype.setFromBox=function(){let e=new n.Vector3;return function(t,r){let n=r.min,i=r.max,o=1/0,s=-1/0;for(let r=0;r<=1;r++)for(let a=0;a<=1;a++)for(let l=0;l<=1;l++){e.x=n.x*r+i.x*(1-r),e.y=n.y*a+i.y*(1-a),e.z=n.z*l+i.z*(1-l);let u=t.dot(e);o=Math.min(u,o),s=Math.max(u,s)}this.min=o,this.max=s}}(),new i}),s("8VYkb",function(t,r){e(t.exports,"ExtendedTriangle",()=>l);var n=o("ilwiq"),i=o("2OKGW"),s=o("f56Km");function a(e){return 1e-15>Math.abs(e)}class l extends n.Triangle{constructor(...e){super(...e),this.isExtendedTriangle=!0,this.satAxes=[,,,,].fill().map(()=>new n.Vector3),this.satBounds=[,,,,].fill().map(()=>new i.SeparatingAxisBounds),this.points=[this.a,this.b,this.c],this.sphere=new n.Sphere,this.plane=new n.Plane,this.needsUpdate=!0}intersectsSphere(e){return(0,s.sphereIntersectTriangle)(e,this)}update(){let e=this.a,t=this.b,r=this.c,n=this.points,i=this.satAxes,o=this.satBounds,s=i[0],a=o[0];this.getNormal(s),a.setFromPoints(s,n);let l=i[1],u=o[1];l.subVectors(e,t),u.setFromPoints(l,n);let c=i[2],d=o[2];c.subVectors(t,r),d.setFromPoints(c,n);let f=i[3],p=o[3];f.subVectors(r,e),p.setFromPoints(f,n),this.sphere.setFromPoints(this.points),this.plane.setFromNormalAndCoplanarPoint(s,e),this.needsUpdate=!1}}l.prototype.closestPointToSegment=function(){let e=new n.Vector3,t=new n.Vector3,r=new n.Line3;return function(n,i=null,o=null){let a;let{start:l,end:u}=n,c=this.points,d=1/0;for(let l=0;l<3;l++){let u=(l+1)%3;r.start.copy(c[l]),r.end.copy(c[u]),(0,s.closestPointsSegmentToSegment)(r,n,e,t),(a=e.distanceToSquared(t))<d&&(d=a,i&&i.copy(e),o&&o.copy(t))}return this.closestPointToPoint(l,e),(a=l.distanceToSquared(e))<d&&(d=a,i&&i.copy(e),o&&o.copy(l)),this.closestPointToPoint(u,e),(a=u.distanceToSquared(e))<d&&(d=a,i&&i.copy(e),o&&o.copy(u)),Math.sqrt(d)}}(),l.prototype.intersectsTriangle=function(){let e=new l,t=[,,,],r=[,,,],o=new i.SeparatingAxisBounds,s=new i.SeparatingAxisBounds,u=new n.Vector3,c=new n.Vector3,d=new n.Vector3,f=new n.Vector3,p=new n.Vector3,h=new n.Line3,m=new n.Line3,x=new n.Line3,g=new n.Vector3;function y(e,t,r){let n=e.points,i=0,o=-1;for(let e=0;e<3;e++){let{start:s,end:l}=h;s.copy(n[e]),l.copy(n[(e+1)%3]),h.delta(c);let u=a(t.distanceToPoint(s));if(a(t.normal.dot(c))&&u){r.copy(h),i=2;break}let d=t.intersectLine(h,g);if(!d&&u&&g.copy(s),(d||u)&&!a(g.distanceTo(l))){if(i<=1)(1===i?r.start:r.end).copy(g),u&&(o=i);else if(i>=2){(1===o?r.start:r.end).copy(g),i=2;break}if(2==++i&&-1===o)break}}return i}return function(n,i=null,a=!1){this.needsUpdate&&this.update(),n.isExtendedTriangle?n.needsUpdate&&n.update():(e.copy(n),e.update(),n=e);let l=this.plane,c=n.plane;if(Math.abs(l.normal.dot(c.normal))>1-1e-10){let e=this.satBounds,l=this.satAxes;r[0]=n.a,r[1]=n.b,r[2]=n.c;for(let t=0;t<4;t++){let n=e[t],i=l[t];if(o.setFromPoints(i,r),n.isSeparated(o))return!1}let c=n.satBounds,d=n.satAxes;t[0]=this.a,t[1]=this.b,t[2]=this.c;for(let e=0;e<4;e++){let r=c[e],n=d[e];if(o.setFromPoints(n,t),r.isSeparated(o))return!1}for(let e=0;e<4;e++){let n=l[e];for(let e=0;e<4;e++){let i=d[e];if(u.crossVectors(n,i),o.setFromPoints(u,t),s.setFromPoints(u,r),o.isSeparated(s))return!1}}return i&&(a||console.warn("ExtendedTriangle.intersectsTriangle: Triangles are coplanar which does not support an output edge. Setting edge to 0, 0, 0."),i.start.set(0,0,0),i.end.set(0,0,0)),!0}{let e=y(this,c,m);if(1===e&&n.containsPoint(m.end))return i&&(i.start.copy(m.end),i.end.copy(m.end)),!0;if(2!==e)return!1;let t=y(n,l,x);if(1===t&&this.containsPoint(x.end))return i&&(i.start.copy(x.end),i.end.copy(x.end)),!0;if(2!==t)return!1;if(m.delta(d),x.delta(f),0>d.dot(f)){let e=x.start;x.start=x.end,x.end=e}let r=m.start.dot(d),o=m.end.dot(d),s=x.start.dot(d),a=x.end.dot(d);return(r===a||s===o||o<s!=r<a)&&(i&&(p.subVectors(m.start,x.start),p.dot(d)>0?i.start.copy(m.start):i.start.copy(x.start),p.subVectors(m.end,x.end),0>p.dot(d)?i.end.copy(m.end):i.end.copy(x.end)),!0)}}}(),l.prototype.distanceToPoint=function(){let e=new n.Vector3;return function(t){return this.closestPointToPoint(t,e),t.distanceTo(e)}}(),l.prototype.distanceToTriangle=function(){let e=new n.Vector3,t=new n.Vector3,r=["a","b","c"],i=new n.Line3,o=new n.Line3;return function(n,a=null,l=null){let u=a||l?i:null;if(this.intersectsTriangle(n,u))return(a||l)&&(a&&u.getCenter(a),l&&u.getCenter(l)),0;let c=1/0;for(let t=0;t<3;t++){let i;let o=r[t],s=n[o];this.closestPointToPoint(s,e),(i=s.distanceToSquared(e))<c&&(c=i,a&&a.copy(e),l&&l.copy(s));let u=this[o];n.closestPointToPoint(u,e),(i=u.distanceToSquared(e))<c&&(c=i,a&&a.copy(u),l&&l.copy(e))}for(let u=0;u<3;u++){let d=r[u],f=r[(u+1)%3];i.set(this[d],this[f]);for(let u=0;u<3;u++){let d=r[u],f=r[(u+1)%3];o.set(n[d],n[f]),(0,s.closestPointsSegmentToSegment)(i,o,e,t);let p=e.distanceToSquared(t);p<c&&(c=p,a&&a.copy(e),l&&l.copy(t))}}return Math.sqrt(c)}}()}),s("f56Km",function(t,r){e(t.exports,"closestPointsSegmentToSegment",()=>s),e(t.exports,"sphereIntersectTriangle",()=>a);var n=o("ilwiq");let i=function(){let e=new n.Vector3,t=new n.Vector3,r=new n.Vector3;return function(n,i,o){let s,a;let l=n.start,u=i.start;r.subVectors(l,u),e.subVectors(n.end,n.start),t.subVectors(i.end,i.start);let c=r.dot(t),d=t.dot(e),f=t.dot(t),p=r.dot(e),h=e.dot(e)*f-d*d;s=0!==h?(c*d-p*f)/h:0,a=(c+s*d)/f,o.x=s,o.y=a}}(),s=function(){let e=new n.Vector2,t=new n.Vector3,r=new n.Vector3;return function(n,o,s,a){i(n,o,e);let l=e.x,u=e.y;if(l>=0&&l<=1&&u>=0&&u<=1){n.at(l,s),o.at(u,a);return}if(l>=0&&l<=1){u<0?o.at(0,a):o.at(1,a),n.closestPointToPoint(a,!0,s);return}if(u>=0&&u<=1){l<0?n.at(0,s):n.at(1,s),o.closestPointToPoint(s,!0,a);return}{let e,i;if(e=l<0?n.start:n.end,i=u<0?o.start:o.end,n.closestPointToPoint(i,!0,t),o.closestPointToPoint(e,!0,r),t.distanceToSquared(i)<=r.distanceToSquared(e)){s.copy(t),a.copy(i);return}s.copy(e),a.copy(r);return}}}(),a=function(){let e=new n.Vector3,t=new n.Vector3,r=new n.Plane,i=new n.Line3;return function(n,o){let{radius:s,center:a}=n,{a:l,b:u,c:c}=o;if(i.start=l,i.end=u,i.closestPointToPoint(a,!0,e).distanceTo(a)<=s||(i.start=l,i.end=c,i.closestPointToPoint(a,!0,e).distanceTo(a)<=s)||(i.start=u,i.end=c,i.closestPointToPoint(a,!0,e).distanceTo(a)<=s))return!0;let d=o.getPlane(r);if(Math.abs(d.distanceToPoint(a))<=s){let e=d.projectPoint(a,t);if(o.containsPoint(e))return!0}return!1}}()}),s("7EZfU",function(t,r){e(t.exports,"ExtendedTrianglePool",()=>a);var n=o("8VYkb"),i=o("1l8b2");class s extends i.PrimitivePool{constructor(){super(()=>new n.ExtendedTriangle)}}let a=new s}),s("1l8b2",function(t,r){e(t.exports,"PrimitivePool",()=>n);class n{constructor(e){this._getNewPrimitive=e,this._primitives=[]}getPrimitive(){let e=this._primitives;return 0===e.length?this._getNewPrimitive():e.pop()}releasePrimitive(e){this._primitives.push(e)}}}),s("8hs00",function(t,r){let n,i;e(t.exports,"shapecast",()=>h);var s=o("ilwiq"),a=o("alNGj"),l=o("eADNI"),u=o("1l8b2"),c=o("8x2iv"),d=o("xqrrD");let f=[],p=new u.PrimitivePool(()=>new s.Box3);function h(e,t,r,o,s,u){n=p.getPrimitive(),i=p.getPrimitive(),f.push(n,i),(0,d.BufferStack).setBuffer(e._roots[t]);let h=function e(t,r,o,s,u=null,f=0,p=0){let{float32Array:h,uint16Array:m,uint32Array:x}=d.BufferStack,g=2*t;if((0,c.IS_LEAF)(g,m)){let e=(0,c.OFFSET)(t,x),r=(0,c.COUNT)(g,m);return(0,l.arrayToBox)((0,c.BOUNDING_DATA_INDEX)(t),h,n),s(e,r,!1,p,f+t,n)}{let g,T,b,A,B,w;let I=(0,c.LEFT_NODE)(t),_=(0,c.RIGHT_NODE)(t,x),E=I,S=_;if(u&&(b=n,A=i,(0,l.arrayToBox)((0,c.BOUNDING_DATA_INDEX)(E),h,b),(0,l.arrayToBox)((0,c.BOUNDING_DATA_INDEX)(S),h,A),g=u(b),(T=u(A))<g)){E=_,S=I;let e=g;g=T,T=e,b=A}b||(b=n,(0,l.arrayToBox)((0,c.BOUNDING_DATA_INDEX)(E),h,b));let M=o(b,(0,c.IS_LEAF)(2*E,m),g,p+1,f+E);if(M===a.CONTAINED){let e=y(E);B=s(e,v(E)-e,!0,p+1,f+E,b)}else B=M&&e(E,r,o,s,u,f,p+1);if(B)return!0;A=i,(0,l.arrayToBox)((0,c.BOUNDING_DATA_INDEX)(S),h,A);let D=o(A,(0,c.IS_LEAF)(2*S,m),T,p+1,f+S);if(D===a.CONTAINED){let e=y(S);w=s(e,v(S)-e,!0,p+1,f+S,A)}else w=D&&e(S,r,o,s,u,f,p+1);if(w)return!0;return!1;function y(e){let{uint16Array:t,uint32Array:r}=d.BufferStack,n=2*e;for(;!(0,c.IS_LEAF)(n,t);)n=2*(e=(0,c.LEFT_NODE)(e));return(0,c.OFFSET)(e,r)}function v(e){let{uint16Array:t,uint32Array:r}=d.BufferStack,n=2*e;for(;!(0,c.IS_LEAF)(n,t);)n=2*(e=(0,c.RIGHT_NODE)(e,r));return(0,c.OFFSET)(e,r)+(0,c.COUNT)(n,t)}}}(0,e.geometry,r,o,s,u);(0,d.BufferStack).clearBuffer(),p.releasePrimitive(n),p.releasePrimitive(i),f.pop(),f.pop();let m=f.length;return m>0&&(i=f[m-1],n=f[m-2]),h}}),s("xqrrD",function(t,r){e(t.exports,"BufferStack",()=>n);let n=new class{constructor(){this.float32Array=null,this.uint16Array=null,this.uint32Array=null;let e=[],t=null;this.setBuffer=r=>{t&&e.push(t),t=r,this.float32Array=new Float32Array(r),this.uint16Array=new Uint16Array(r),this.uint32Array=new Uint32Array(r)},this.clearBuffer=()=>{t=null,this.float32Array=null,this.uint16Array=null,this.uint32Array=null,0!==e.length&&this.setBuffer(e.pop())}}}}),s("8VlEg",function(t,r){e(t.exports,"closestPointToPoint",()=>a);var n=o("ilwiq");let i=new n.Vector3,s=new n.Vector3;function a(e,t,r={},n=0,o=1/0){let a=n*n,l=o*o,u=1/0,c=null;if(e.shapecast({boundsTraverseOrder:e=>(i.copy(t).clamp(e.min,e.max),i.distanceToSquared(t)),intersectsBounds:(e,t,r)=>r<u&&r<l,intersectsTriangle:(e,r)=>{e.closestPointToPoint(t,i);let n=t.distanceToSquared(i);return n<u&&(s.copy(i),u=n,c=r),n<a}}),u===1/0)return null;let d=Math.sqrt(u);return r.point?r.point.copy(s):r.point=s.clone(),r.distance=d,r.faceIndex=c,r}}),s("9Kyri",function(t,r){e(t.exports,"intersectTris",()=>s),e(t.exports,"intersectClosestTri",()=>a),e(t.exports,"iterateOverTriangles",()=>l);var n=o("7pS02"),i=o("dRxiJ");function s(e,t,r,i,o,s){let{geometry:a,_indirectBuffer:l}=e;for(let e=i,l=i+o;e<l;e++)(0,n.intersectTri)(a,t,r,e,s)}function a(e,t,r,i,o){let{geometry:s,_indirectBuffer:a}=e,l=1/0,u=null;for(let e=i,a=i+o;e<a;e++){let i;(i=(0,n.intersectTri)(s,t,r,e))&&i.distance<l&&(u=i,l=i.distance)}return u}function l(e,t,r,n,o,s,a){let{geometry:l}=r,{index:u}=l,c=l.attributes.position;for(let r=e,l=t+e;r<l;r++){let e;if(e=r,(0,i.setTriangle)(a,3*e,u,c),a.needsUpdate=!0,n(a,e,o,s))return!0}return!1}}),s("7pS02",function(t,r){e(t.exports,"intersectTri",()=>m);var n=o("ilwiq");let i=new n.Vector3,s=new n.Vector3,a=new n.Vector3,l=new n.Vector2,u=new n.Vector2,c=new n.Vector2,d=new n.Vector3,f=new n.Vector3,p=new n.Vector3,h=new n.Vector3;function m(e,t,r,o,m){let x=3*o,g=x+0,y=x+1,v=x+2,T=e.index;e.index&&(g=T.getX(g),y=T.getX(y),v=T.getX(v));let{position:b,normal:A,uv:B,uv1:w}=e.attributes,I=function(e,t,r,o,m,x,g,y,v){i.fromBufferAttribute(t,x),s.fromBufferAttribute(t,g),a.fromBufferAttribute(t,y);let T=null===(v===n.BackSide?e.intersectTriangle(a,s,i,!0,h):e.intersectTriangle(i,s,a,v!==n.DoubleSide,h))?null:{distance:e.origin.distanceTo(h),point:h.clone()};if(T){o&&(l.fromBufferAttribute(o,x),u.fromBufferAttribute(o,g),c.fromBufferAttribute(o,y),T.uv=(0,n.Triangle).getInterpolation(h,i,s,a,l,u,c,new n.Vector2)),m&&(l.fromBufferAttribute(m,x),u.fromBufferAttribute(m,g),c.fromBufferAttribute(m,y),T.uv1=(0,n.Triangle).getInterpolation(h,i,s,a,l,u,c,new n.Vector2)),r&&(d.fromBufferAttribute(r,x),f.fromBufferAttribute(r,g),p.fromBufferAttribute(r,y),T.normal=(0,n.Triangle).getInterpolation(h,i,s,a,d,f,p,new n.Vector3),T.normal.dot(e.direction)>0&&T.normal.multiplyScalar(-1));let t={a:x,b:g,c:y,normal:new n.Vector3,materialIndex:0};(0,n.Triangle).getNormal(i,s,a,t.normal),T.face=t,T.faceIndex=x}return T}(r,b,A,B,w,g,y,v,t);return I?(I.faceIndex=o,m&&m.push(I),I):null}}),s("dRxiJ",function(t,r){function n(e,t,r,n){let i=e.a,o=e.b,s=e.c,a=t,l=t+1,u=t+2;r&&(a=r.getX(a),l=r.getX(l),u=r.getX(u)),i.x=n.getX(a),i.y=n.getY(a),i.z=n.getZ(a),o.x=n.getX(l),o.y=n.getY(l),o.z=n.getZ(l),s.x=n.getX(u),s.y=n.getY(u),s.z=n.getZ(u)}e(t.exports,"setTriangle",()=>n),o("ilwiq")}),s("ayHng",function(t,r){e(t.exports,"refit",()=>i);var n=o("alNGj");function i(e,t=null){let r,i,o,s;t&&Array.isArray(t)&&(t=new Set(t));let a=e.geometry,l=a.index?a.index.array:null,u=a.attributes.position,c=0,d=e._roots;for(let e=0,a=d.length;e<a;e++)i=new Uint32Array(r=d[e]),o=new Uint16Array(r),s=new Float32Array(r),function e(r,a,c=!1){let d=2*r;if(o[d+15]===n.IS_LEAFNODE_FLAG){let e=i[r+6],t=o[d+14],n=1/0,a=1/0,c=1/0,f=-1/0,p=-1/0,h=-1/0;for(let r=3*e,i=3*(e+t);r<i;r++){let e=l[r],t=u.getX(e),i=u.getY(e),o=u.getZ(e);t<n&&(n=t),t>f&&(f=t),i<a&&(a=i),i>p&&(p=i),o<c&&(c=o),o>h&&(h=o)}return(s[r+0]!==n||s[r+1]!==a||s[r+2]!==c||s[r+3]!==f||s[r+4]!==p||s[r+5]!==h)&&(s[r+0]=n,s[r+1]=a,s[r+2]=c,s[r+3]=f,s[r+4]=p,s[r+5]=h,!0)}{let n=r+8,o=i[r+6],l=n+a,u=o+a,d=c,f=!1,p=!1;t?d||(f=t.has(l),p=t.has(u),d=!f&&!p):(f=!0,p=!0);let h=d||f,m=d||p,x=!1;h&&(x=e(n,a,d));let g=!1;m&&(g=e(o,a,d));let y=x||g;if(y)for(let e=0;e<3;e++){let t=n+e,i=o+e,a=s[t],l=s[t+3],u=s[i],c=s[i+3];s[r+e]=a<u?a:u,s[r+e+3]=l>c?l:c}return y}}(0,c),c+=r.byteLength}}),s("laUNa",function(t,r){e(t.exports,"raycast",()=>l);var n=o("d4vta"),i=o("8x2iv"),s=o("xqrrD"),a=o("9Kyri");function l(e,t,r,o,l){(0,s.BufferStack).setBuffer(e._roots[t]),function e(t,r,o,l,u){let{float32Array:c,uint16Array:d,uint32Array:f}=s.BufferStack,p=2*t;if((0,i.IS_LEAF)(p,d)){let e=(0,i.OFFSET)(t,f),n=(0,i.COUNT)(p,d);(0,a.intersectTris)(r,o,l,e,n,u)}else{let s=(0,i.LEFT_NODE)(t);(0,n.intersectRay)(s,c,l)&&e(s,r,o,l,u);let a=(0,i.RIGHT_NODE)(t,f);(0,n.intersectRay)(a,c,l)&&e(a,r,o,l,u)}}(0,e,r,o,l),(0,s.BufferStack).clearBuffer()}}),s("d4vta",function(t,r){e(t.exports,"intersectRay",()=>n);function n(e,t,r){let n,i,o,s,a,l;let u=1/r.direction.x,c=1/r.direction.y,d=1/r.direction.z,f=r.origin.x,p=r.origin.y,h=r.origin.z,m=t[e],x=t[e+3],g=t[e+1],y=t[e+3+1],v=t[e+2],T=t[e+3+2];return u>=0?(n=(m-f)*u,i=(x-f)*u):(n=(x-f)*u,i=(m-f)*u),c>=0?(o=(g-p)*c,s=(y-p)*c):(o=(y-p)*c,s=(g-p)*c),!(n>s)&&!(o>i)&&((o>n||isNaN(n))&&(n=o),(s<i||isNaN(i))&&(i=s),d>=0?(a=(v-h)*d,l=(T-h)*d):(a=(T-h)*d,l=(v-h)*d),!(n>l)&&!(a>i)&&((l<i||i!=i)&&(i=l),!(i<0)))}}),s("1SnJR",function(t,r){e(t.exports,"raycastFirst",()=>u);var n=o("8x2iv"),i=o("xqrrD"),s=o("d4vta"),a=o("9Kyri");let l=["x","y","z"];function u(e,t,r,o){(0,i.BufferStack).setBuffer(e._roots[t]);let u=function e(t,r,o,u){let{float32Array:c,uint16Array:d,uint32Array:f}=i.BufferStack,p=2*t;if((0,n.IS_LEAF)(p,d)){let e=(0,n.OFFSET)(t,f),i=(0,n.COUNT)(p,d);return(0,a.intersectClosestTri)(r,o,u,e,i)}{let i,a;let d=(0,n.SPLIT_AXIS)(t,f),p=l[d],h=u.direction[p]>=0;h?(i=(0,n.LEFT_NODE)(t),a=(0,n.RIGHT_NODE)(t,f)):(i=(0,n.RIGHT_NODE)(t,f),a=(0,n.LEFT_NODE)(t));let m=(0,s.intersectRay)(i,c,u)?e(i,r,o,u):null;if(m){let e=m.point[p];if(h?e<=c[a+d]:e>=c[a+d+3])return m}let x=(0,s.intersectRay)(a,c,u)?e(a,r,o,u):null;return m&&x?m.distance<=x.distance?m:x:m||x||null}}(0,e,r,o);return(0,i.BufferStack).clearBuffer(),u}}),s("dhXUU",function(t,r){e(t.exports,"intersectsGeometry",()=>g);var n=o("ilwiq"),i=o("lenTA"),s=o("8VYkb"),a=o("dRxiJ"),l=o("eADNI"),u=o("8x2iv"),c=o("xqrrD");let d=new n.Box3,f=new s.ExtendedTriangle,p=new s.ExtendedTriangle,h=new n.Matrix4,m=new i.OrientedBox,x=new i.OrientedBox;function g(e,t,r,n){(0,c.BufferStack).setBuffer(e._roots[t]);let i=function e(t,r,n,i,o=null){let{float32Array:s,uint16Array:g,uint32Array:y}=c.BufferStack,v=2*t;if(null===o&&(n.boundingBox||n.computeBoundingBox(),m.set(n.boundingBox.min,n.boundingBox.max,i),o=m),(0,u.IS_LEAF)(v,g)){let e=r.geometry,o=e.index,c=e.attributes.position,d=n.index,m=n.attributes.position,T=(0,u.OFFSET)(t,y),b=(0,u.COUNT)(v,g);if(h.copy(i).invert(),n.boundsTree)return(0,l.arrayToBox)((0,u.BOUNDING_DATA_INDEX)(t),s,x),x.matrix.copy(h),x.needsUpdate=!0,n.boundsTree.shapecast({intersectsBounds:e=>x.intersectsBox(e),intersectsTriangle:e=>{e.a.applyMatrix4(i),e.b.applyMatrix4(i),e.c.applyMatrix4(i),e.needsUpdate=!0;for(let t=3*T,r=(b+T)*3;t<r;t+=3)if((0,a.setTriangle)(p,t,o,c),p.needsUpdate=!0,e.intersectsTriangle(p))return!0;return!1}});for(let e=3*T,t=(b+T)*3;e<t;e+=3){(0,a.setTriangle)(f,e,o,c),f.a.applyMatrix4(h),f.b.applyMatrix4(h),f.c.applyMatrix4(h),f.needsUpdate=!0;for(let e=0,t=d.count;e<t;e+=3)if((0,a.setTriangle)(p,e,d,m),p.needsUpdate=!0,f.intersectsTriangle(p))return!0}}else{let a=t+8,c=y[t+6];return(0,l.arrayToBox)((0,u.BOUNDING_DATA_INDEX)(a),s,d),!!(o.intersectsBox(d)&&e(a,r,n,i,o))||((0,l.arrayToBox)((0,u.BOUNDING_DATA_INDEX)(c),s,d),!!(o.intersectsBox(d)&&e(c,r,n,i,o)))}}(0,e,r,n);return(0,c.BufferStack).clearBuffer(),i}}),s("dnRHH",function(t,r){e(t.exports,"closestPointToGeometry",()=>x);var n=o("ilwiq"),i=o("lenTA"),s=o("dRxiJ"),a=o("5Gkg5"),l=o("7EZfU");let u=new n.Matrix4,c=new i.OrientedBox,d=new i.OrientedBox,f=new n.Vector3,p=new n.Vector3,h=new n.Vector3,m=new n.Vector3;function x(e,t,r,n={},i={},o=0,x=1/0){t.boundingBox||t.computeBoundingBox(),c.set(t.boundingBox.min,t.boundingBox.max,r),c.needsUpdate=!0;let g=e.geometry,y=g.attributes.position,v=g.index,T=t.attributes.position,b=t.index,A=(0,l.ExtendedTrianglePool).getPrimitive(),B=(0,l.ExtendedTrianglePool).getPrimitive(),w=null,I=null;i&&(w=h,I=m);let _=1/0,E=null,S=null;return(u.copy(r).invert(),d.matrix.copy(u),e.shapecast({boundsTraverseOrder:e=>c.distanceToBox(e),intersectsBounds:(e,t,r)=>r<_&&r<x&&(t&&(d.min.copy(e.min),d.max.copy(e.max),d.needsUpdate=!0),!0),intersectsRange:(e,n)=>{if(t.boundsTree)return t.boundsTree.shapecast({boundsTraverseOrder:e=>d.distanceToBox(e),intersectsBounds:(e,t,r)=>r<_&&r<x,intersectsRange:(t,i)=>{for(let a=t,l=t+i;a<l;a++){(0,s.setTriangle)(B,3*a,b,T),B.a.applyMatrix4(r),B.b.applyMatrix4(r),B.c.applyMatrix4(r),B.needsUpdate=!0;for(let t=e,r=e+n;t<r;t++){(0,s.setTriangle)(A,3*t,v,y),A.needsUpdate=!0;let e=A.distanceToTriangle(B,f,w);if(e<_&&(p.copy(f),I&&I.copy(w),_=e,E=t,S=a),e<o)return!0}}}});{let i=(0,a.getTriCount)(t);for(let t=0;t<i;t++){(0,s.setTriangle)(B,3*t,b,T),B.a.applyMatrix4(r),B.b.applyMatrix4(r),B.c.applyMatrix4(r),B.needsUpdate=!0;for(let r=e,i=e+n;r<i;r++){(0,s.setTriangle)(A,3*r,v,y),A.needsUpdate=!0;let e=A.distanceToTriangle(B,f,w);if(e<_&&(p.copy(f),I&&I.copy(w),_=e,E=r,S=t),e<o)return!0}}}}}),(0,l.ExtendedTrianglePool).releasePrimitive(A),(0,l.ExtendedTrianglePool).releasePrimitive(B),_===1/0)?null:(n.point?n.point.copy(p):n.point=p.clone(),n.distance=_,n.faceIndex=E,i&&(i.point?i.point.copy(I):i.point=I.clone(),i.point.applyMatrix4(u),p.applyMatrix4(u),i.distance=p.sub(i.point).length(),i.faceIndex=S),n)}}),s("gDpfV",function(t,r){e(t.exports,"intersectTris_indirect",()=>s),e(t.exports,"intersectClosestTri_indirect",()=>a),e(t.exports,"iterateOverTriangles_indirect",()=>l);var n=o("7pS02"),i=o("dRxiJ");function s(e,t,r,i,o,s){let{geometry:a,_indirectBuffer:l}=e;for(let e=i,u=i+o;e<u;e++){let i=l?l[e]:e;(0,n.intersectTri)(a,t,r,i,s)}}function a(e,t,r,i,o){let{geometry:s,_indirectBuffer:a}=e,l=1/0,u=null;for(let e=i,c=i+o;e<c;e++){let i;(i=(0,n.intersectTri)(s,t,r,a?a[e]:e))&&i.distance<l&&(u=i,l=i.distance)}return u}function l(e,t,r,n,o,s,a){let{geometry:l}=r,{index:u}=l,c=l.attributes.position;for(let l=e,d=t+e;l<d;l++){let e;if(e=r.resolveTriangleIndex(l),(0,i.setTriangle)(a,3*e,u,c),a.needsUpdate=!0,n(a,e,o,s))return!0}return!1}}),s("iERXt",function(t,r){e(t.exports,"refit_indirect",()=>i);var n=o("alNGj");function i(e,t=null){let r,i,o,s;t&&Array.isArray(t)&&(t=new Set(t));let a=e.geometry,l=a.index?a.index.array:null,u=a.attributes.position,c=0,d=e._roots;for(let a=0,f=d.length;a<f;a++)i=new Uint32Array(r=d[a]),o=new Uint16Array(r),s=new Float32Array(r),function r(a,c,d=!1){let f=2*a;if(o[f+15]===n.IS_LEAFNODE_FLAG){let t=i[a+6],r=o[f+14],n=1/0,c=1/0,d=1/0,p=-1/0,h=-1/0,m=-1/0;for(let i=t,o=t+r;i<o;i++){let t=3*e.resolveTriangleIndex(i);for(let e=0;e<3;e++){let r=t+e;r=l?l[r]:r;let i=u.getX(r),o=u.getY(r),s=u.getZ(r);i<n&&(n=i),i>p&&(p=i),o<c&&(c=o),o>h&&(h=o),s<d&&(d=s),s>m&&(m=s)}}return(s[a+0]!==n||s[a+1]!==c||s[a+2]!==d||s[a+3]!==p||s[a+4]!==h||s[a+5]!==m)&&(s[a+0]=n,s[a+1]=c,s[a+2]=d,s[a+3]=p,s[a+4]=h,s[a+5]=m,!0)}{let e=a+8,n=i[a+6],o=e+c,l=n+c,u=d,f=!1,p=!1;t?u||(f=t.has(o),p=t.has(l),u=!f&&!p):(f=!0,p=!0);let h=u||f,m=u||p,x=!1;h&&(x=r(e,c,u));let g=!1;m&&(g=r(n,c,u));let y=x||g;if(y)for(let t=0;t<3;t++){let r=e+t,i=n+t,o=s[r],l=s[r+3],u=s[i],c=s[i+3];s[a+t]=o<u?o:u,s[a+t+3]=l>c?l:c}return y}}(0,c),c+=r.byteLength}}),s("kNP8c",function(t,r){e(t.exports,"raycast_indirect",()=>l);var n=o("d4vta"),i=o("8x2iv"),s=o("xqrrD"),a=o("gDpfV");function l(e,t,r,o,l){(0,s.BufferStack).setBuffer(e._roots[t]),function e(t,r,o,l,u){let{float32Array:c,uint16Array:d,uint32Array:f}=s.BufferStack,p=2*t;if((0,i.IS_LEAF)(p,d)){let e=(0,i.OFFSET)(t,f),n=(0,i.COUNT)(p,d);(0,a.intersectTris_indirect)(r,o,l,e,n,u)}else{let s=(0,i.LEFT_NODE)(t);(0,n.intersectRay)(s,c,l)&&e(s,r,o,l,u);let a=(0,i.RIGHT_NODE)(t,f);(0,n.intersectRay)(a,c,l)&&e(a,r,o,l,u)}}(0,e,r,o,l),(0,s.BufferStack).clearBuffer()}}),s("ZxvHI",function(t,r){e(t.exports,"raycastFirst_indirect",()=>u);var n=o("8x2iv"),i=o("xqrrD"),s=o("d4vta"),a=o("gDpfV");let l=["x","y","z"];function u(e,t,r,o){(0,i.BufferStack).setBuffer(e._roots[t]);let u=function e(t,r,o,u){let{float32Array:c,uint16Array:d,uint32Array:f}=i.BufferStack,p=2*t;if((0,n.IS_LEAF)(p,d)){let e=(0,n.OFFSET)(t,f),i=(0,n.COUNT)(p,d);return(0,a.intersectClosestTri_indirect)(r,o,u,e,i)}{let i,a;let d=(0,n.SPLIT_AXIS)(t,f),p=l[d],h=u.direction[p]>=0;h?(i=(0,n.LEFT_NODE)(t),a=(0,n.RIGHT_NODE)(t,f)):(i=(0,n.RIGHT_NODE)(t,f),a=(0,n.LEFT_NODE)(t));let m=(0,s.intersectRay)(i,c,u)?e(i,r,o,u):null;if(m){let e=m.point[p];if(h?e<=c[a+d]:e>=c[a+d+3])return m}let x=(0,s.intersectRay)(a,c,u)?e(a,r,o,u):null;return m&&x?m.distance<=x.distance?m:x:m||x||null}}(0,e,r,o);return(0,i.BufferStack).clearBuffer(),u}}),s("bD1WL",function(t,r){e(t.exports,"intersectsGeometry_indirect",()=>g);var n=o("ilwiq"),i=o("lenTA"),s=o("8VYkb"),a=o("dRxiJ"),l=o("eADNI"),u=o("8x2iv"),c=o("xqrrD");let d=new n.Box3,f=new s.ExtendedTriangle,p=new s.ExtendedTriangle,h=new n.Matrix4,m=new i.OrientedBox,x=new i.OrientedBox;function g(e,t,r,n){(0,c.BufferStack).setBuffer(e._roots[t]);let i=function e(t,r,n,i,o=null){let{float32Array:s,uint16Array:g,uint32Array:y}=c.BufferStack,v=2*t;if(null===o&&(n.boundingBox||n.computeBoundingBox(),m.set(n.boundingBox.min,n.boundingBox.max,i),o=m),(0,u.IS_LEAF)(v,g)){let e=r.geometry,o=e.index,c=e.attributes.position,d=n.index,m=n.attributes.position,T=(0,u.OFFSET)(t,y),b=(0,u.COUNT)(v,g);if(h.copy(i).invert(),n.boundsTree)return(0,l.arrayToBox)((0,u.BOUNDING_DATA_INDEX)(t),s,x),x.matrix.copy(h),x.needsUpdate=!0,n.boundsTree.shapecast({intersectsBounds:e=>x.intersectsBox(e),intersectsTriangle:e=>{e.a.applyMatrix4(i),e.b.applyMatrix4(i),e.c.applyMatrix4(i),e.needsUpdate=!0;for(let t=T,n=b+T;t<n;t++)if((0,a.setTriangle)(p,3*r.resolveTriangleIndex(t),o,c),p.needsUpdate=!0,e.intersectsTriangle(p))return!0;return!1}});for(let e=T,t=b+T;e<t;e++){let t=r.resolveTriangleIndex(e);(0,a.setTriangle)(f,3*t,o,c),f.a.applyMatrix4(h),f.b.applyMatrix4(h),f.c.applyMatrix4(h),f.needsUpdate=!0;for(let e=0,t=d.count;e<t;e+=3)if((0,a.setTriangle)(p,e,d,m),p.needsUpdate=!0,f.intersectsTriangle(p))return!0}}else{let a=t+8,c=y[t+6];return(0,l.arrayToBox)((0,u.BOUNDING_DATA_INDEX)(a),s,d),!!(o.intersectsBox(d)&&e(a,r,n,i,o))||((0,l.arrayToBox)((0,u.BOUNDING_DATA_INDEX)(c),s,d),!!(o.intersectsBox(d)&&e(c,r,n,i,o)))}}(0,e,r,n);return(0,c.BufferStack).clearBuffer(),i}}),s("gUrAj",function(t,r){e(t.exports,"closestPointToGeometry_indirect",()=>x);var n=o("ilwiq"),i=o("lenTA"),s=o("dRxiJ"),a=o("5Gkg5"),l=o("7EZfU");let u=new n.Matrix4,c=new i.OrientedBox,d=new i.OrientedBox,f=new n.Vector3,p=new n.Vector3,h=new n.Vector3,m=new n.Vector3;function x(e,t,r,n={},i={},o=0,x=1/0){t.boundingBox||t.computeBoundingBox(),c.set(t.boundingBox.min,t.boundingBox.max,r),c.needsUpdate=!0;let g=e.geometry,y=g.attributes.position,v=g.index,T=t.attributes.position,b=t.index,A=(0,l.ExtendedTrianglePool).getPrimitive(),B=(0,l.ExtendedTrianglePool).getPrimitive(),w=null,I=null;i&&(w=h,I=m);let _=1/0,E=null,S=null;return(u.copy(r).invert(),d.matrix.copy(u),e.shapecast({boundsTraverseOrder:e=>c.distanceToBox(e),intersectsBounds:(e,t,r)=>r<_&&r<x&&(t&&(d.min.copy(e.min),d.max.copy(e.max),d.needsUpdate=!0),!0),intersectsRange:(n,i)=>{if(t.boundsTree){let a=t.boundsTree;return a.shapecast({boundsTraverseOrder:e=>d.distanceToBox(e),intersectsBounds:(e,t,r)=>r<_&&r<x,intersectsRange:(t,l)=>{for(let u=t,c=t+l;u<c;u++){let t=a.resolveTriangleIndex(u);(0,s.setTriangle)(B,3*t,b,T),B.a.applyMatrix4(r),B.b.applyMatrix4(r),B.c.applyMatrix4(r),B.needsUpdate=!0;for(let t=n,r=n+i;t<r;t++){let r=e.resolveTriangleIndex(t);(0,s.setTriangle)(A,3*r,v,y),A.needsUpdate=!0;let n=A.distanceToTriangle(B,f,w);if(n<_&&(p.copy(f),I&&I.copy(w),_=n,E=t,S=u),n<o)return!0}}}})}{let l=(0,a.getTriCount)(t);for(let t=0;t<l;t++){(0,s.setTriangle)(B,3*t,b,T),B.a.applyMatrix4(r),B.b.applyMatrix4(r),B.c.applyMatrix4(r),B.needsUpdate=!0;for(let r=n,a=n+i;r<a;r++){let n=e.resolveTriangleIndex(r);(0,s.setTriangle)(A,3*n,v,y),A.needsUpdate=!0;let i=A.distanceToTriangle(B,f,w);if(i<_&&(p.copy(f),I&&I.copy(w),_=i,E=r,S=t),i<o)return!0}}}}}),(0,l.ExtendedTrianglePool).releasePrimitive(A),(0,l.ExtendedTrianglePool).releasePrimitive(B),_===1/0)?null:(n.point?n.point.copy(p):n.point=p.clone(),n.distance=_,n.faceIndex=E,i&&(i.point?i.point.copy(I):i.point=I.clone(),i.point.applyMatrix4(u),p.applyMatrix4(u),i.distance=p.sub(i.point).length(),i.faceIndex=S),n)}}),s("cSOJe",function(t,r){function n(){return"undefined"!=typeof SharedArrayBuffer}function i(e,t){if(null===e)return e;if(e.buffer){let r=e.buffer;if(r.constructor===t)return e;let n=new e.constructor(new t(r.byteLength));return n.set(e),n}{if(e.constructor===t)return e;let r=new t(e.byteLength);return new Uint8Array(r).set(new Uint8Array(e)),r}}e(t.exports,"isSharedArrayBufferSupported",()=>n),e(t.exports,"convertToBufferType",()=>i)}),s("f1zUR",function(t,r){e(t.exports,"bvhcast",()=>g);var n=o("ilwiq"),i=o("xqrrD"),s=o("8x2iv"),a=o("eADNI"),l=o("1l8b2");let u=new i.BufferStack.constructor,c=new i.BufferStack.constructor,d=new l.PrimitivePool(()=>new n.Box3),f=new n.Box3,p=new n.Box3,h=new n.Box3,m=new n.Box3,x=!1;function g(e,t,r,i){let o;if(x)throw Error("MeshBVH: Recursive calls to bvhcast not supported.");x=!0;let l=e._roots,g=t._roots,y=0,v=0,T=new(0,n.Matrix4)().copy(r).invert();for(let e=0,t=l.length;e<t;e++){u.setBuffer(l[e]),v=0;let t=d.getPrimitive();(0,a.arrayToBox)((0,s.BOUNDING_DATA_INDEX)(0),u.float32Array,t),t.applyMatrix4(T);for(let n=0,l=g.length;n<l&&(c.setBuffer(g[e]),o=function e(t,r,n,i,o,l=0,x=0,g=0,y=0,v=null,T=!1){let b,A;T?(b=c,A=u):(b=u,A=c);let B=b.float32Array,w=b.uint32Array,I=b.uint16Array,_=A.float32Array,E=A.uint32Array,S=A.uint16Array,M=2*t,D=2*r,N=(0,s.IS_LEAF)(M,I),F=(0,s.IS_LEAF)(D,S),P=!1;if(F&&N)P=T?o((0,s.OFFSET)(r,E),(0,s.COUNT)(2*r,S),(0,s.OFFSET)(t,w),(0,s.COUNT)(2*t,I),y,x+r,g,l+t):o((0,s.OFFSET)(t,w),(0,s.COUNT)(2*t,I),(0,s.OFFSET)(r,E),(0,s.COUNT)(2*r,S),g,l+t,y,x+r);else if(F){let u=d.getPrimitive();(0,a.arrayToBox)((0,s.BOUNDING_DATA_INDEX)(r),_,u),u.applyMatrix4(n);let c=(0,s.LEFT_NODE)(t),h=(0,s.RIGHT_NODE)(t,w);(0,a.arrayToBox)((0,s.BOUNDING_DATA_INDEX)(c),B,f),(0,a.arrayToBox)((0,s.BOUNDING_DATA_INDEX)(h),B,p);let m=u.intersectsBox(f),v=u.intersectsBox(p);P=m&&e(r,c,i,n,o,x,l,y,g+1,u,!T)||v&&e(r,h,i,n,o,x,l,y,g+1,u,!T),d.releasePrimitive(u)}else{let u=(0,s.LEFT_NODE)(r),c=(0,s.RIGHT_NODE)(r,E);(0,a.arrayToBox)((0,s.BOUNDING_DATA_INDEX)(u),_,h),(0,a.arrayToBox)((0,s.BOUNDING_DATA_INDEX)(c),_,m);let b=v.intersectsBox(h),A=v.intersectsBox(m);if(b&&A)P=e(t,u,n,i,o,l,x,g,y+1,v,T)||e(t,c,n,i,o,l,x,g,y+1,v,T);else if(b){if(N)P=e(t,u,n,i,o,l,x,g,y+1,v,T);else{let r=d.getPrimitive();r.copy(h).applyMatrix4(n);let c=(0,s.LEFT_NODE)(t),m=(0,s.RIGHT_NODE)(t,w);(0,a.arrayToBox)((0,s.BOUNDING_DATA_INDEX)(c),B,f),(0,a.arrayToBox)((0,s.BOUNDING_DATA_INDEX)(m),B,p);let v=r.intersectsBox(f),b=r.intersectsBox(p);P=v&&e(u,c,i,n,o,x,l,y,g+1,r,!T)||b&&e(u,m,i,n,o,x,l,y,g+1,r,!T),d.releasePrimitive(r)}}else if(A){if(N)P=e(t,c,n,i,o,l,x,g,y+1,v,T);else{let r=d.getPrimitive();r.copy(m).applyMatrix4(n);let u=(0,s.LEFT_NODE)(t),h=(0,s.RIGHT_NODE)(t,w);(0,a.arrayToBox)((0,s.BOUNDING_DATA_INDEX)(u),B,f),(0,a.arrayToBox)((0,s.BOUNDING_DATA_INDEX)(h),B,p);let v=r.intersectsBox(f),b=r.intersectsBox(p);P=v&&e(c,u,i,n,o,x,l,y,g+1,r,!T)||b&&e(c,h,i,n,o,x,l,y,g+1,r,!T),d.releasePrimitive(r)}}}return P}(0,0,r,T,i,y,v,0,0,t),c.clearBuffer(),v+=g[n].length,!o);n++);if(d.releasePrimitive(t),u.clearBuffer(),y+=l[e].length,o)break}return x=!1,o}}),s("dCCOj",function(t,r){e(t.exports,"NO_CHANGE",()=>l),e(t.exports,"GEOMETRY_ADJUSTED",()=>u),e(t.exports,"GEOMETRY_REBUILT",()=>c),e(t.exports,"StaticGeometryGenerator",()=>d);var n=o("ilwiq"),i=o("7V7xb"),s=o("8LUnK"),a=o("2b74x");let l=0,u=1,c=2;class d{constructor(e){this.objects=null,this.useGroups=!0,this.applyWorldTransforms=!0,this.generateMissingAttributes=!0,this.overwriteIndex=!0,this.attributes=["position","normal","color","tangent","uv","uv2"],this._intermediateGeometry=new Map,this._geometryMergeSets=new WeakMap,this._mergeOrder=[],this._dummyMesh=null,this.setObjects(e||[])}_getDummyMesh(){if(!this._dummyMesh){let e=new n.MeshBasicMaterial,t=new n.BufferGeometry;t.setAttribute("position",new n.BufferAttribute(new Float32Array(9),3)),this._dummyMesh=new n.Mesh(t,e)}return this._dummyMesh}_getMeshes(){let e=[];return function(e,t){for(let r=0,n=e.length;r<n;r++)e[r].traverseVisible(e=>{e.isMesh&&t(e)})}(this.objects,t=>{e.push(t)}),e.sort((e,t)=>e.uuid>t.uuid?1:e.uuid<t.uuid?-1:0),0===e.length&&e.push(this._getDummyMesh()),e}_updateIntermediateGeometries(){let{_intermediateGeometry:e}=this,t=this._getMeshes(),r=new Set(e.keys()),n={attributes:this.attributes,applyWorldTransforms:this.applyWorldTransforms};for(let i=0,o=t.length;i<o;i++){let o=t[i],l=o.uuid;r.delete(l);let u=e.get(l);u&&u.isCompatible(o,this.attributes)||(u&&u.dispose(),u=new a.BakedGeometry,e.set(l,u)),u.updateFrom(o,n)&&this.generateMissingAttributes&&(0,s.setCommonAttributes)(u,this.attributes)}r.forEach(t=>{e.delete(t)})}setObjects(e){Array.isArray(e)?this.objects=[...e]:this.objects=[e]}generate(e=new n.BufferGeometry){let{useGroups:t,overwriteIndex:r,_intermediateGeometry:o,_geometryMergeSets:s}=this,a=this._getMeshes(),d=[],f=[],p=s.get(e)||[];this._updateIntermediateGeometries();let h=!1;a.length!==p.length&&(h=!0);for(let e=0,t=a.length;e<t;e++){let t=a[e],r=o.get(t.uuid);f.push(r);let n=p[e];n&&n.uuid===r.uuid?n.version!==r.version?d.push(!1):d.push(!0):(d.push(!1),h=!0)}(function(e,t,r){if(0===e.length){t.setIndex(null);let e=t.attributes;for(let r in e)t.deleteAttribute(r);for(let e in r.attributes)t.setAttribute(r.attributes[e],new n.BufferAttribute(new Float32Array(0),4,!1))}else(0,i.mergeGeometries)(e,r,t);for(let e in t.attributes)t.attributes[e].needsUpdate=!0})(f,e,{useGroups:t,forceUpdate:h,skipAssigningAttributes:d,overwriteIndex:r}),h&&e.dispose(),s.set(e,f.map(e=>({version:e.version,uuid:e.uuid})));let m=l;return h?m=c:d.includes(!1)&&(m=u),{changeType:m,materials:function(e){let t=[];for(let r=0,n=e.length;r<n;r++){let n=e[r];Array.isArray(n.material)?t.push(...n.material):t.push(n.material)}return t}(a),geometry:e}}}}),s("7V7xb",function(t,r){e(t.exports,"mergeGeometries",()=>s);var n=o("ilwiq"),i=o("iYpwh");function s(e,t={},r=new n.BufferGeometry){let{useGroups:o=!1,forceUpdate:s=!1,skipAssigningAttributes:a=[],overwriteIndex:l=!0}=t;!function(e){let t=null!==e[0].index,r=new Set(Object.keys(e[0].attributes));if(!e[0].getAttribute("position"))throw Error("StaticGeometryGenerator: position attribute is required.");for(let n=0;n<e.length;++n){let i=e[n],o=0;if(t!==(null!==i.index))throw Error("StaticGeometryGenerator: All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them.");for(let e in i.attributes){if(!r.has(e))throw Error('StaticGeometryGenerator: All geometries must have compatible attributes; make sure "'+e+'" attribute exists among all geometries, or in none of them.');o++}if(o!==r.size)throw Error("StaticGeometryGenerator: All geometries must have the same number of attributes.")}}(e);let u=null!==e[0].index,c=u?function(e){let t=0;for(let r=0,n=e.length;r<n;r++)t+=e[r].getIndex().count;return t}(e):-1,d=function(e){let t=0;for(let r=0,n=e.length;r<n;r++)t+=e[r].getAttribute("position").count;return t}(e);if(function(e,t,r){e.index&&e.index.count!==t&&e.setIndex(null);let n=e.attributes;for(let t in n)n[t].count!==r&&e.deleteAttribute(t)}(r,c,d),o){let t=0;for(let n=0,i=e.length;n<i;n++){let i;let o=e[n];i=u?o.getIndex().count:o.getAttribute("position").count,r.addGroup(t,i,n),t+=i}}if(u){let t=!1;if(r.index||(r.setIndex(new n.BufferAttribute(new Uint32Array(c),1,!1)),t=!0),t||l){let n=0,i=0,o=r.getIndex();for(let r=0,l=e.length;r<l;r++){let l=e[r],u=l.getIndex();if(!(!s&&!t&&a[r]))for(let e=0;e<u.count;++e)o.setX(n+e,u.getX(e)+i);n+=u.count,i+=l.getAttribute("position").count}}}let f=Object.keys(e[0].attributes);for(let t=0,n=f.length;t<n;t++){let n=!1,o=f[t];if(!r.getAttribute(o)){let t=e[0].getAttribute(o);r.setAttribute(o,(0,i.createAttributeClone)(t,d)),n=!0}let l=0,u=r.getAttribute(o);for(let t=0,r=e.length;t<r;t++){let r=e[t],c=!s&&!n&&a[t],d=r.getAttribute(o);if(!c){if("color"===o&&u.itemSize!==d.itemSize)for(let e=l,t=d.count;e<t;e++)d.setXYZW(e,u.getX(e),u.getY(e),u.getZ(e),1);else(0,i.copyAttributeContents)(d,u,l)}l+=d.count}}}}),s("iYpwh",function(t,r){e(t.exports,"copyAttributeContents",()=>i),e(t.exports,"createAttributeClone",()=>s),e(t.exports,"validateAttributes",()=>a);var n=o("ilwiq");function i(e,t,r=0){if(e.isInterleavedBufferAttribute){let n=e.itemSize;for(let i=0,o=e.count;i<o;i++){let o=i+r;t.setX(o,e.getX(i)),n>=2&&t.setY(o,e.getY(i)),n>=3&&t.setZ(o,e.getZ(i)),n>=4&&t.setW(o,e.getW(i))}}else{let n=t.array,i=n.constructor,o=n.BYTES_PER_ELEMENT*e.itemSize*r;new i(n.buffer,o,e.array.length).set(e.array)}}function s(e,t=null){let r=e.array.constructor,i=e.normalized,o=e.itemSize,s=null===t?e.count:t;return new n.BufferAttribute(new r(o*s),o,i)}function a(e,t){if(!e&&!t)return!0;if(!!e!=!!t)return!1;let r=e.count===t.count,n=e.normalized===t.normalized,i=e.array.constructor===t.array.constructor,o=e.itemSize===t.itemSize;return!!r&&!!n&&!!i&&!!o}}),s("8LUnK",function(t,r){e(t.exports,"updateMaterialIndexAttribute",()=>i),e(t.exports,"setCommonAttributes",()=>s);var n=o("ilwiq");function i(e,t,r){let i=e.index,o=e.attributes.position.count,s=i?i.count:o,a=e.groups;0===a.length&&(a=[{count:s,start:0,materialIndex:0}]);let l=e.getAttribute("materialIndex");if(!l||l.count!==o){let t;t=r.length<=255?new Uint8Array(o):new Uint16Array(o),l=new n.BufferAttribute(t,1,!1),e.deleteAttribute("materialIndex"),e.setAttribute("materialIndex",l)}let u=l.array;for(let e=0;e<a.length;e++){let n=a[e],o=n.start,l=Math.min(n.count,s-o),c=Array.isArray(t)?t[n.materialIndex]:t,d=r.indexOf(c);for(let e=0;e<l;e++){let t=o+e;i&&(t=i.getX(t)),u[t]=d}}}function s(e,t){if(!e.index){let t=e.attributes.position.count,r=Array(t);for(let e=0;e<t;e++)r[e]=e;e.setIndex(r)}if(!e.attributes.normal&&t&&t.includes("normal")&&e.computeVertexNormals(),!e.attributes.uv&&t&&t.includes("uv")){let t=e.attributes.position.count;e.setAttribute("uv",new n.BufferAttribute(new Float32Array(2*t),2,!1))}if(!e.attributes.uv2&&t&&t.includes("uv2")){let t=e.attributes.position.count;e.setAttribute("uv2",new n.BufferAttribute(new Float32Array(2*t),2,!1))}if(!e.attributes.tangent&&t&&t.includes("tangent")){if(e.attributes.uv&&e.attributes.normal)e.computeTangents();else{let t=e.attributes.position.count;e.setAttribute("tangent",new n.BufferAttribute(new Float32Array(4*t),4,!1))}}if(!e.attributes.color&&t&&t.includes("color")){let t=new Float32Array(4*e.attributes.position.count);t.fill(1),e.setAttribute("color",new n.BufferAttribute(t,4))}}}),s("2b74x",function(t,r){e(t.exports,"BakedGeometry",()=>l);var n=o("ilwiq"),i=o("ddiur"),s=o("gz5pJ"),a=o("iYpwh");class l extends n.BufferGeometry{constructor(){super(),this.version=0,this.hash=null,this._diff=new i.MeshDiff}isCompatible(e,t){let r=e.geometry;for(let e=0;e<t.length;e++){let n=t[e],i=r.attributes[n],o=this.attributes[n];if(i&&!(0,a.validateAttributes)(i,o))return!1}return!0}updateFrom(e,t){let r=this._diff;return!!r.didChange(e)&&((0,s.convertToStaticGeometry)(e,t,this),r.updateFrom(e),this.version++,this.hash=`${this.uuid}_${this.version}`,!0)}}}),s("ddiur",function(t,r){e(t.exports,"MeshDiff",()=>l);var n=o("ilwiq"),i=o("6ply6");function s(e){let t=e.uuid,r=Object.values(e.attributes);for(let n of(e.index&&(r.push(e.index),t+=`index|${e.index.version}`),Object.keys(r).sort())){let e=r[n];t+=`${n}_${e.version}|`}return t}function a(e){let t=e.skeleton;if(!t)return null;{t.boneTexture||t.computeBoneTexture();let e=(0,i.bufferToHash)(t.boneTexture.image.data.buffer);return`${e}_${t.boneTexture.uuid}`}}class l{constructor(e=null){this.matrixWorld=new n.Matrix4,this.geometryHash=null,this.skeletonHash=null,this.primitiveCount=-1,null!==e&&this.updateFrom(e)}updateFrom(e){let t=e.geometry,r=(t.index?t.index.count:t.attributes.position.count)/3;this.matrixWorld.copy(e.matrixWorld),this.geometryHash=s(t),this.primitiveCount=r,this.skeletonHash=a(e)}didChange(e){let t=e.geometry,r=(t.index?t.index.count:t.attributes.position.count)/3;return!(this.matrixWorld.equals(e.matrixWorld)&&this.geometryHash===s(t)&&this.skeletonHash===a(e)&&this.primitiveCount===r)}}}),s("6ply6",function(t,r){e(t.exports,"bufferToHash",()=>n);function n(e){let t=0;if(0!==e.byteLength){let r=new Uint8Array(e);for(let n=0;n<e.byteLength;n++)t=(t<<5)-t+r[n]|0}return t}}),s("gz5pJ",function(t,r){e(t.exports,"convertToStaticGeometry",()=>y);var n=o("ilwiq"),i=o("iYpwh");let s=new n.Vector3,a=new n.Vector3,l=new n.Vector3,u=new n.Vector4,c=new n.Vector3,d=new n.Vector3,f=new n.Vector4,p=new n.Vector4,h=new n.Matrix4,m=new n.Matrix4;function x(e,t,r){let n=e.skeleton,i=e.geometry,o=n.bones,s=n.boneInverses;f.fromBufferAttribute(i.attributes.skinIndex,t),p.fromBufferAttribute(i.attributes.skinWeight,t),h.elements.fill(0);for(let e=0;e<4;e++){let t=p.getComponent(e);if(0!==t){let r=f.getComponent(e);m.multiplyMatrices(o[r].matrixWorld,s[r]),function(e,t,r){let n=e.elements,i=t.elements;for(let e=0,t=i.length;e<t;e++)n[e]+=i[e]*r}(h,m,t)}}return h.multiply(e.bindMatrix).premultiply(e.bindMatrixInverse),r.transformDirection(h),r}function g(e,t,r,n,i){c.set(0,0,0);for(let o=0,s=e.length;o<s;o++){let s=t[o],a=e[o];0!==s&&(d.fromBufferAttribute(a,n),r?c.addScaledVector(d,s):c.addScaledVector(d.sub(i),s))}i.add(c)}function y(e,t={},r=new n.BufferGeometry){t={applyWorldTransforms:!0,attributes:[],...t};let o=e.geometry,c=t.applyWorldTransforms,d=t.attributes.includes("normal"),f=t.attributes.includes("tangent"),p=o.attributes,h=r.attributes;for(let e in r.attributes)t.attributes.includes(e)&&e in o.attributes||r.deleteAttribute(e);!r.index&&o.index&&(r.index=o.index.clone()),h.position||r.setAttribute("position",(0,i.createAttributeClone)(p.position)),d&&!h.normal&&p.normal&&r.setAttribute("normal",(0,i.createAttributeClone)(p.normal)),f&&!h.tangent&&p.tangent&&r.setAttribute("tangent",(0,i.createAttributeClone)(p.tangent)),(0,i.validateAttributes)(o.index,r.index),(0,i.validateAttributes)(p.position,h.position),d&&(0,i.validateAttributes)(p.normal,h.normal),f&&(0,i.validateAttributes)(p.tangent,h.tangent);let m=p.position,y=d?p.normal:null,v=f?p.tangent:null,T=o.morphAttributes.position,b=o.morphAttributes.normal,A=o.morphAttributes.tangent,B=o.morphTargetsRelative,w=e.morphTargetInfluences,I=new n.Matrix3;I.getNormalMatrix(e.matrixWorld),o.index&&r.index.array.set(o.index.array);for(let t=0,r=p.position.count;t<r;t++)s.fromBufferAttribute(m,t),y&&a.fromBufferAttribute(y,t),v&&(u.fromBufferAttribute(v,t),l.fromBufferAttribute(v,t)),w&&(T&&g(T,w,B,t,s),b&&g(b,w,B,t,a),A&&g(A,w,B,t,l)),e.isSkinnedMesh&&(e.applyBoneTransform(t,s),y&&x(e,t,a),v&&x(e,t,l)),c&&s.applyMatrix4(e.matrixWorld),h.position.setXYZ(t,s.x,s.y,s.z),y&&(c&&a.applyNormalMatrix(I),h.normal.setXYZ(t,a.x,a.y,a.z)),v&&(c&&l.transformDirection(e.matrixWorld),h.tangent.setXYZW(t,l.x,l.y,l.z,u.w));for(let e in t.attributes){let n=t.attributes[e];"position"!==n&&"tangent"!==n&&"normal"!==n&&n in p&&(h[n]||r.setAttribute(n,(0,i.createAttributeClone)(p[n])),(0,i.validateAttributes)(p[n],h[n]),(0,i.copyAttributeContents)(p[n],h[n]))}return 0>e.matrixWorld.determinant()&&function(e){let{index:t,attributes:r}=e;if(t)for(let e=0,r=t.count;e<r;e+=3){let r=t.getX(e),n=t.getX(e+2);t.setX(e,n),t.setX(e+2,r)}else for(let e in r){let t=r[e],n=t.itemSize;for(let e=0,r=t.count;e<r;e+=3)for(let r=0;r<n;r++){let n=t.getComponent(e,r),i=t.getComponent(e+2,r);t.setComponent(e,r,i),t.setComponent(e+2,r,n)}}}(r),r}}),s("2vjHu",function(e,r){var n=o("7rn9W"),i=o("b78om"),s=o("eL5d2"),a=o("fFvuX");t(e.exports,n),t(e.exports,i),t(e.exports,s),t(e.exports,a)}),s("7rn9W",function(t,r){e(t.exports,"common_functions",()=>n);let n=`

// A stack of uint32 indices can can store the indices for
// a perfectly balanced tree with a depth up to 31. Lower stack
// depth gets higher performance.
//
// However not all trees are balanced. Best value to set this to
// is the trees max depth.
#ifndef BVH_STACK_DEPTH
#define BVH_STACK_DEPTH 60
#endif

#ifndef INFINITY
#define INFINITY 1e20
#endif

// Utilities
uvec4 uTexelFetch1D( usampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

ivec4 iTexelFetch1D( isampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

vec4 texelFetch1D( sampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

vec4 textureSampleBarycoord( sampler2D tex, vec3 barycoord, uvec3 faceIndices ) {

	return
		barycoord.x * texelFetch1D( tex, faceIndices.x ) +
		barycoord.y * texelFetch1D( tex, faceIndices.y ) +
		barycoord.z * texelFetch1D( tex, faceIndices.z );

}

void ndcToCameraRay(
	vec2 coord, mat4 cameraWorld, mat4 invProjectionMatrix,
	out vec3 rayOrigin, out vec3 rayDirection
) {

	// get camera look direction and near plane for camera clipping
	vec4 lookDirection = cameraWorld * vec4( 0.0, 0.0, - 1.0, 0.0 );
	vec4 nearVector = invProjectionMatrix * vec4( 0.0, 0.0, - 1.0, 1.0 );
	float near = abs( nearVector.z / nearVector.w );

	// get the camera direction and position from camera matrices
	vec4 origin = cameraWorld * vec4( 0.0, 0.0, 0.0, 1.0 );
	vec4 direction = invProjectionMatrix * vec4( coord, 0.5, 1.0 );
	direction /= direction.w;
	direction = cameraWorld * direction - origin;

	// slide the origin along the ray until it sits at the near clip plane position
	origin.xyz += direction.xyz * near / dot( direction, lookDirection );

	rayOrigin = origin.xyz;
	rayDirection = direction.xyz;

}
`}),s("b78om",function(t,r){e(t.exports,"bvh_distance_functions",()=>n);let n=`

float dot2( vec3 v ) {

	return dot( v, v );

}

// https://www.shadertoy.com/view/ttfGWl
vec3 closestPointToTriangle( vec3 p, vec3 v0, vec3 v1, vec3 v2, out vec3 barycoord ) {

    vec3 v10 = v1 - v0;
    vec3 v21 = v2 - v1;
    vec3 v02 = v0 - v2;

	vec3 p0 = p - v0;
	vec3 p1 = p - v1;
	vec3 p2 = p - v2;

    vec3 nor = cross( v10, v02 );

    // method 2, in barycentric space
    vec3  q = cross( nor, p0 );
    float d = 1.0 / dot2( nor );
    float u = d * dot( q, v02 );
    float v = d * dot( q, v10 );
    float w = 1.0 - u - v;

	if( u < 0.0 ) {

		w = clamp( dot( p2, v02 ) / dot2( v02 ), 0.0, 1.0 );
		u = 0.0;
		v = 1.0 - w;

	} else if( v < 0.0 ) {

		u = clamp( dot( p0, v10 ) / dot2( v10 ), 0.0, 1.0 );
		v = 0.0;
		w = 1.0 - u;

	} else if( w < 0.0 ) {

		v = clamp( dot( p1, v21 ) / dot2( v21 ), 0.0, 1.0 );
		w = 0.0;
		u = 1.0-v;

	}

	barycoord = vec3( u, v, w );
    return u * v1 + v * v2 + w * v0;

}

float distanceToTriangles(
	// geometry info and triangle range
	sampler2D positionAttr, usampler2D indexAttr, uint offset, uint count,

	// point and cut off range
	vec3 point, float closestDistanceSquared,

	// outputs
	inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord, inout float side, inout vec3 outPoint
) {

	bool found = false;
	vec3 localBarycoord;
	for ( uint i = offset, l = offset + count; i < l; i ++ ) {

		uvec3 indices = uTexelFetch1D( indexAttr, i ).xyz;
		vec3 a = texelFetch1D( positionAttr, indices.x ).rgb;
		vec3 b = texelFetch1D( positionAttr, indices.y ).rgb;
		vec3 c = texelFetch1D( positionAttr, indices.z ).rgb;

		// get the closest point and barycoord
		vec3 closestPoint = closestPointToTriangle( point, a, b, c, localBarycoord );
		vec3 delta = point - closestPoint;
		float sqDist = dot2( delta );
		if ( sqDist < closestDistanceSquared ) {

			// set the output results
			closestDistanceSquared = sqDist;
			faceIndices = uvec4( indices.xyz, i );
			faceNormal = normalize( cross( a - b, b - c ) );
			barycoord = localBarycoord;
			outPoint = closestPoint;
			side = sign( dot( faceNormal, delta ) );

		}

	}

	return closestDistanceSquared;

}

float distanceSqToBounds( vec3 point, vec3 boundsMin, vec3 boundsMax ) {

	vec3 clampedPoint = clamp( point, boundsMin, boundsMax );
	vec3 delta = point - clampedPoint;
	return dot( delta, delta );

}

float distanceSqToBVHNodeBoundsPoint( vec3 point, sampler2D bvhBounds, uint currNodeIndex ) {

	uint cni2 = currNodeIndex * 2u;
	vec3 boundsMin = texelFetch1D( bvhBounds, cni2 ).xyz;
	vec3 boundsMax = texelFetch1D( bvhBounds, cni2 + 1u ).xyz;
	return distanceSqToBounds( point, boundsMin, boundsMax );

}

// use a macro to hide the fact that we need to expand the struct into separate fields
#define\
	bvhClosestPointToPoint(\
		bvh,\
		point, faceIndices, faceNormal, barycoord, side, outPoint\
	)\
	_bvhClosestPointToPoint(\
		bvh.position, bvh.index, bvh.bvhBounds, bvh.bvhContents,\
		point, faceIndices, faceNormal, barycoord, side, outPoint\
	)

float _bvhClosestPointToPoint(
	// bvh info
	sampler2D bvh_position, usampler2D bvh_index, sampler2D bvh_bvhBounds, usampler2D bvh_bvhContents,

	// point to check
	vec3 point,

	// output variables
	inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout vec3 outPoint
 ) {

	// stack needs to be twice as long as the deepest tree we expect because
	// we push both the left and right child onto the stack every traversal
	int ptr = 0;
	uint stack[ BVH_STACK_DEPTH ];
	stack[ 0 ] = 0u;

	float closestDistanceSquared = pow( 100000.0, 2.0 );
	bool found = false;
	while ( ptr > - 1 && ptr < BVH_STACK_DEPTH ) {

		uint currNodeIndex = stack[ ptr ];
		ptr --;

		// check if we intersect the current bounds
		float boundsHitDistance = distanceSqToBVHNodeBoundsPoint( point, bvh_bvhBounds, currNodeIndex );
		if ( boundsHitDistance > closestDistanceSquared ) {

			continue;

		}

		uvec2 boundsInfo = uTexelFetch1D( bvh_bvhContents, currNodeIndex ).xy;
		bool isLeaf = bool( boundsInfo.x & 0xffff0000u );
		if ( isLeaf ) {

			uint count = boundsInfo.x & 0x0000ffffu;
			uint offset = boundsInfo.y;
			closestDistanceSquared = distanceToTriangles(
				bvh_position, bvh_index, offset, count, point, closestDistanceSquared,

				// outputs
				faceIndices, faceNormal, barycoord, side, outPoint
			);

		} else {

			uint leftIndex = currNodeIndex + 1u;
			uint splitAxis = boundsInfo.x & 0x0000ffffu;
			uint rightIndex = boundsInfo.y;
			bool leftToRight = distanceSqToBVHNodeBoundsPoint( point, bvh_bvhBounds, leftIndex ) < distanceSqToBVHNodeBoundsPoint( point, bvh_bvhBounds, rightIndex );//rayDirection[ splitAxis ] >= 0.0;
			uint c1 = leftToRight ? leftIndex : rightIndex;
			uint c2 = leftToRight ? rightIndex : leftIndex;

			// set c2 in the stack so we traverse it later. We need to keep track of a pointer in
			// the stack while we traverse. The second pointer added is the one that will be
			// traversed first
			ptr ++;
			stack[ ptr ] = c2;
			ptr ++;
			stack[ ptr ] = c1;

		}

	}

	return sqrt( closestDistanceSquared );

}
`}),s("eL5d2",function(t,r){e(t.exports,"bvh_ray_functions",()=>n);let n=`

#ifndef TRI_INTERSECT_EPSILON
#define TRI_INTERSECT_EPSILON 1e-5
#endif

// Raycasting
bool intersectsBounds( vec3 rayOrigin, vec3 rayDirection, vec3 boundsMin, vec3 boundsMax, out float dist ) {

	// https://www.reddit.com/r/opengl/comments/8ntzz5/fast_glsl_ray_box_intersection/
	// https://tavianator.com/2011/ray_box.html
	vec3 invDir = 1.0 / rayDirection;

	// find intersection distances for each plane
	vec3 tMinPlane = invDir * ( boundsMin - rayOrigin );
	vec3 tMaxPlane = invDir * ( boundsMax - rayOrigin );

	// get the min and max distances from each intersection
	vec3 tMinHit = min( tMaxPlane, tMinPlane );
	vec3 tMaxHit = max( tMaxPlane, tMinPlane );

	// get the furthest hit distance
	vec2 t = max( tMinHit.xx, tMinHit.yz );
	float t0 = max( t.x, t.y );

	// get the minimum hit distance
	t = min( tMaxHit.xx, tMaxHit.yz );
	float t1 = min( t.x, t.y );

	// set distance to 0.0 if the ray starts inside the box
	dist = max( t0, 0.0 );

	return t1 >= dist;

}

bool intersectsTriangle(
	vec3 rayOrigin, vec3 rayDirection, vec3 a, vec3 b, vec3 c,
	out vec3 barycoord, out vec3 norm, out float dist, out float side
) {

	// https://stackoverflow.com/questions/42740765/intersection-between-line-and-triangle-in-3d
	vec3 edge1 = b - a;
	vec3 edge2 = c - a;
	norm = cross( edge1, edge2 );

	float det = - dot( rayDirection, norm );
	float invdet = 1.0 / det;

	vec3 AO = rayOrigin - a;
	vec3 DAO = cross( AO, rayDirection );

	vec4 uvt;
	uvt.x = dot( edge2, DAO ) * invdet;
	uvt.y = - dot( edge1, DAO ) * invdet;
	uvt.z = dot( AO, norm ) * invdet;
	uvt.w = 1.0 - uvt.x - uvt.y;

	// set the hit information
	barycoord = uvt.wxy; // arranged in A, B, C order
	dist = uvt.z;
	side = sign( det );
	norm = side * normalize( norm );

	// add an epsilon to avoid misses between triangles
	uvt += vec4( TRI_INTERSECT_EPSILON );

	return all( greaterThanEqual( uvt, vec4( 0.0 ) ) );

}

bool intersectTriangles(
	// geometry info and triangle range
	sampler2D positionAttr, usampler2D indexAttr, uint offset, uint count,

	// ray
	vec3 rayOrigin, vec3 rayDirection,

	// outputs
	inout float minDistance, inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout float dist
) {

	bool found = false;
	vec3 localBarycoord, localNormal;
	float localDist, localSide;
	for ( uint i = offset, l = offset + count; i < l; i ++ ) {

		uvec3 indices = uTexelFetch1D( indexAttr, i ).xyz;
		vec3 a = texelFetch1D( positionAttr, indices.x ).rgb;
		vec3 b = texelFetch1D( positionAttr, indices.y ).rgb;
		vec3 c = texelFetch1D( positionAttr, indices.z ).rgb;

		if (
			intersectsTriangle( rayOrigin, rayDirection, a, b, c, localBarycoord, localNormal, localDist, localSide )
			&& localDist < minDistance
		) {

			found = true;
			minDistance = localDist;

			faceIndices = uvec4( indices.xyz, i );
			faceNormal = localNormal;

			side = localSide;
			barycoord = localBarycoord;
			dist = localDist;

		}

	}

	return found;

}

bool intersectsBVHNodeBounds( vec3 rayOrigin, vec3 rayDirection, sampler2D bvhBounds, uint currNodeIndex, out float dist ) {

	uint cni2 = currNodeIndex * 2u;
	vec3 boundsMin = texelFetch1D( bvhBounds, cni2 ).xyz;
	vec3 boundsMax = texelFetch1D( bvhBounds, cni2 + 1u ).xyz;
	return intersectsBounds( rayOrigin, rayDirection, boundsMin, boundsMax, dist );

}

// use a macro to hide the fact that we need to expand the struct into separate fields
#define\
	bvhIntersectFirstHit(\
		bvh,\
		rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist\
	)\
	_bvhIntersectFirstHit(\
		bvh.position, bvh.index, bvh.bvhBounds, bvh.bvhContents,\
		rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist\
	)

bool _bvhIntersectFirstHit(
	// bvh info
	sampler2D bvh_position, usampler2D bvh_index, sampler2D bvh_bvhBounds, usampler2D bvh_bvhContents,

	// ray
	vec3 rayOrigin, vec3 rayDirection,

	// output variables split into separate variables due to output precision
	inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout float dist
) {

	// stack needs to be twice as long as the deepest tree we expect because
	// we push both the left and right child onto the stack every traversal
	int ptr = 0;
	uint stack[ BVH_STACK_DEPTH ];
	stack[ 0 ] = 0u;

	float triangleDistance = INFINITY;
	bool found = false;
	while ( ptr > - 1 && ptr < BVH_STACK_DEPTH ) {

		uint currNodeIndex = stack[ ptr ];
		ptr --;

		// check if we intersect the current bounds
		float boundsHitDistance;
		if (
			! intersectsBVHNodeBounds( rayOrigin, rayDirection, bvh_bvhBounds, currNodeIndex, boundsHitDistance )
			|| boundsHitDistance > triangleDistance
		) {

			continue;

		}

		uvec2 boundsInfo = uTexelFetch1D( bvh_bvhContents, currNodeIndex ).xy;
		bool isLeaf = bool( boundsInfo.x & 0xffff0000u );

		if ( isLeaf ) {

			uint count = boundsInfo.x & 0x0000ffffu;
			uint offset = boundsInfo.y;

			found = intersectTriangles(
				bvh_position, bvh_index, offset, count,
				rayOrigin, rayDirection, triangleDistance,
				faceIndices, faceNormal, barycoord, side, dist
			) || found;

		} else {

			uint leftIndex = currNodeIndex + 1u;
			uint splitAxis = boundsInfo.x & 0x0000ffffu;
			uint rightIndex = boundsInfo.y;

			bool leftToRight = rayDirection[ splitAxis ] >= 0.0;
			uint c1 = leftToRight ? leftIndex : rightIndex;
			uint c2 = leftToRight ? rightIndex : leftIndex;

			// set c2 in the stack so we traverse it later. We need to keep track of a pointer in
			// the stack while we traverse. The second pointer added is the one that will be
			// traversed first
			ptr ++;
			stack[ ptr ] = c2;

			ptr ++;
			stack[ ptr ] = c1;

		}

	}

	return found;

}
`}),s("fFvuX",function(t,r){e(t.exports,"bvh_struct_definitions",()=>n);let n=`
struct BVH {

	usampler2D index;
	sampler2D position;

	sampler2D bvhBounds;
	usampler2D bvhContents;

};
`}),s("3mzmA",function(t,r){e(t.exports,"MeshBVHUniformStruct",()=>u);var n=o("ilwiq"),i=o("hN8zD"),s=o("alNGj"),a=o("8x2iv"),l=o("5Gkg5");class u{constructor(){this.index=new i.UIntVertexAttributeTexture,this.position=new i.FloatVertexAttributeTexture,this.bvhBounds=new n.DataTexture,this.bvhContents=new n.DataTexture,this._cachedIndexAttr=null,this.index.overrideItemSize=3}updateFrom(e){let{geometry:t}=e;if(function(e,t,r){let i=e._roots;if(1!==i.length)throw Error("MeshBVHUniformStruct: Multi-root BVHs not supported.");let o=i[0],l=new Uint16Array(o),u=new Uint32Array(o),c=new Float32Array(o),d=o.byteLength/s.BYTES_PER_NODE,f=2*Math.ceil(Math.sqrt(d/2)),p=new Float32Array(4*f*f),h=Math.ceil(Math.sqrt(d)),m=new Uint32Array(2*h*h);for(let e=0;e<d;e++){let t=e*s.BYTES_PER_NODE/4,r=2*t,n=(0,a.BOUNDING_DATA_INDEX)(t);for(let t=0;t<3;t++)p[8*e+0+t]=c[n+0+t],p[8*e+4+t]=c[n+3+t];if((0,a.IS_LEAF)(r,l)){let n=(0,a.COUNT)(r,l),i=(0,a.OFFSET)(t,u),o=4294901760|n;m[2*e+0]=o,m[2*e+1]=i}else{let r=4*(0,a.RIGHT_NODE)(t,u)/s.BYTES_PER_NODE,n=(0,a.SPLIT_AXIS)(t,u);m[2*e+0]=n,m[2*e+1]=r}}t.image.data=p,t.image.width=f,t.image.height=f,t.format=n.RGBAFormat,t.type=n.FloatType,t.internalFormat="RGBA32F",t.minFilter=n.NearestFilter,t.magFilter=n.NearestFilter,t.generateMipmaps=!1,t.needsUpdate=!0,t.dispose(),r.image.data=m,r.image.width=h,r.image.height=h,r.format=n.RGIntegerFormat,r.type=n.UnsignedIntType,r.internalFormat="RG32UI",r.minFilter=n.NearestFilter,r.magFilter=n.NearestFilter,r.generateMipmaps=!1,r.needsUpdate=!0,r.dispose()}(e,this.bvhBounds,this.bvhContents),this.position.updateFrom(t.attributes.position),e.indirect){let r=e._indirectBuffer;if(null===this._cachedIndexAttr||this._cachedIndexAttr.count!==r.length){if(t.index)this._cachedIndexAttr=t.index.clone();else{let e=(0,l.getIndexArray)((0,l.getVertexCount)(t));this._cachedIndexAttr=new n.BufferAttribute(e,1,!1)}}(function(e,t,r){let n=r.array,i=e.index?e.index.array:null;for(let e=0,r=t.length;e<r;e++){let r=3*e,o=3*t[e];for(let e=0;e<3;e++)n[r+e]=i?i[o+e]:o+e}})(t,r,this._cachedIndexAttr),this.index.updateFrom(this._cachedIndexAttr)}else this.index.updateFrom(t.index)}dispose(){let{index:e,position:t,bvhBounds:r,bvhContents:n}=this;e&&e.dispose(),t&&t.dispose(),r&&r.dispose(),n&&n.dispose()}}}),s("hN8zD",function(t,r){e(t.exports,"UIntVertexAttributeTexture",()=>a),e(t.exports,"FloatVertexAttributeTexture",()=>l);var n=o("ilwiq");function i(e){switch(e){case 1:return n.RedIntegerFormat;case 2:return n.RGIntegerFormat;case 3:case 4:return n.RGBAIntegerFormat}}class s extends n.DataTexture{constructor(){super(),this.minFilter=n.NearestFilter,this.magFilter=n.NearestFilter,this.generateMipmaps=!1,this.overrideItemSize=null,this._forcedType=null}updateFrom(e){let t,r,o,s;let a=this.overrideItemSize,l=e.itemSize,u=e.count;if(null!==a){if(l*u%a!=0)throw Error("VertexAttributeTexture: overrideItemSize must divide evenly into buffer length.");e.itemSize=a,e.count=u*l/a}let c=e.itemSize,d=e.count,f=e.normalized,p=e.array.constructor,h=p.BYTES_PER_ELEMENT,m=this._forcedType,x=c;if(null===m)switch(p){case Float32Array:m=n.FloatType;break;case Uint8Array:case Uint16Array:case Uint32Array:m=n.UnsignedIntType;break;case Int8Array:case Int16Array:case Int32Array:m=n.IntType}let g=function(e){switch(e){case 1:return"R";case 2:return"RG";case 3:case 4:return"RGBA"}throw Error()}(c);switch(m){case n.FloatType:o=1,r=function(e){switch(e){case 1:return n.RedFormat;case 2:return n.RGFormat;case 3:case 4:return n.RGBAFormat}}(c),f&&1===h?(s=p,g+="8",p===Uint8Array?t=n.UnsignedByteType:(t=n.ByteType,g+="_SNORM")):(s=Float32Array,g+="32F",t=n.FloatType);break;case n.IntType:g+=8*h+"I",o=f?Math.pow(2,8*p.BYTES_PER_ELEMENT-1):1,r=i(c),1===h?(s=Int8Array,t=n.ByteType):2===h?(s=Int16Array,t=n.ShortType):(s=Int32Array,t=n.IntType);break;case n.UnsignedIntType:g+=8*h+"UI",o=f?Math.pow(2,8*p.BYTES_PER_ELEMENT-1):1,r=i(c),1===h?(s=Uint8Array,t=n.UnsignedByteType):2===h?(s=Uint16Array,t=n.UnsignedShortType):(s=Uint32Array,t=n.UnsignedIntType)}3===x&&(r===n.RGBAFormat||r===n.RGBAIntegerFormat)&&(x=4);let y=Math.ceil(Math.sqrt(d))||1,v=new s(x*y*y),T=e.normalized;e.normalized=!1;for(let t=0;t<d;t++){let r=x*t;v[r]=e.getX(t)/o,c>=2&&(v[r+1]=e.getY(t)/o),c>=3&&(v[r+2]=e.getZ(t)/o,4===x&&(v[r+3]=1)),c>=4&&(v[r+3]=e.getW(t)/o)}e.normalized=T,this.internalFormat=g,this.format=r,this.type=t,this.image.width=y,this.image.height=y,this.image.data=v,this.needsUpdate=!0,this.dispose(),e.itemSize=l,e.count=u}}class a extends s{constructor(){super(),this._forcedType=n.UnsignedIntType}}class l extends s{constructor(){super(),this._forcedType=n.FloatType}}}),s("laA5G",function(t,r){e(t.exports,"MATERIAL_PIXELS",()=>a),e(t.exports,"MaterialsTexture",()=>u);var n=o("ilwiq"),i=o("9wqOU"),s=o("6ply6");let a=47;class l{constructor(){this._features={}}isUsed(e){return e in this._features}setUsed(e,t=!0){!1===t?delete this._features[e]:this._features[e]=!0}reset(){this._features={}}}class u extends n.DataTexture{constructor(){super(new Float32Array(4),1,1),this.format=n.RGBAFormat,this.type=n.FloatType,this.wrapS=n.ClampToEdgeWrapping,this.wrapT=n.ClampToEdgeWrapping,this.minFilter=n.NearestFilter,this.magFilter=n.NearestFilter,this.generateMipmaps=!1,this.features=new l}updateFrom(e,t){function r(e,t,r=-1){return t in e&&e[t]?p[(0,i.getTextureHash)(e[t])]:r}function o(e,t,r){return t in e?e[t]:r}function l(e,t,r,n){let i=e[t]&&e[t].isTexture?e[t]:null;if(i){i.matrixAutoUpdate&&i.updateMatrix();let e=i.matrix.elements,t=0;r[n+t++]=e[0],r[n+t++]=e[3],r[n+t++]=e[6],t++,r[n+t++]=e[1],r[n+t++]=e[4],r[n+t++]=e[7],t++}return 8}let u=0,c=Math.ceil(Math.sqrt(e.length*a))||1,{image:d,features:f}=this,p={};for(let e=0,r=t.length;e<r;e++)p[(0,i.getTextureHash)(t[e])]=e;d.width!==c&&(this.dispose(),d.data=new Float32Array(c*c*4),d.width=c,d.height=c);let h=d.data;f.reset();for(let t=0,i=e.length;t<i;t++){let i=e[t];if(i.isFogVolumeMaterial){f.setUsed("FOG");for(let e=0;e<188;e++)h[u+e]=0;h[u+0+0]=i.color.r,h[u+0+1]=i.color.g,h[u+0+2]=i.color.b,h[u+8+3]=o(i,"emissiveIntensity",0),h[u+12+0]=i.emissive.r,h[u+12+1]=i.emissive.g,h[u+12+2]=i.emissive.b,h[u+52+1]=i.density,h[u+52+3]=0,h[u+56+2]=4,u+=188;continue}h[u++]=i.color.r,h[u++]=i.color.g,h[u++]=i.color.b,h[u++]=r(i,"map"),h[u++]=o(i,"metalness",0),h[u++]=r(i,"metalnessMap"),h[u++]=o(i,"roughness",0),h[u++]=r(i,"roughnessMap"),h[u++]=o(i,"ior",1.5),h[u++]=o(i,"transmission",0),h[u++]=r(i,"transmissionMap"),h[u++]=o(i,"emissiveIntensity",0),"emissive"in i?(h[u++]=i.emissive.r,h[u++]=i.emissive.g,h[u++]=i.emissive.b):(h[u++]=0,h[u++]=0,h[u++]=0),h[u++]=r(i,"emissiveMap"),h[u++]=r(i,"normalMap"),"normalScale"in i?(h[u++]=i.normalScale.x,h[u++]=i.normalScale.y):(h[u++]=1,h[u++]=1),h[u++]=o(i,"clearcoat",0),h[u++]=r(i,"clearcoatMap"),h[u++]=o(i,"clearcoatRoughness",0),h[u++]=r(i,"clearcoatRoughnessMap"),h[u++]=r(i,"clearcoatNormalMap"),"clearcoatNormalScale"in i?(h[u++]=i.clearcoatNormalScale.x,h[u++]=i.clearcoatNormalScale.y):(h[u++]=1,h[u++]=1),u++,h[u++]=o(i,"sheen",0),"sheenColor"in i?(h[u++]=i.sheenColor.r,h[u++]=i.sheenColor.g,h[u++]=i.sheenColor.b):(h[u++]=0,h[u++]=0,h[u++]=0),h[u++]=r(i,"sheenColorMap"),h[u++]=o(i,"sheenRoughness",0),h[u++]=r(i,"sheenRoughnessMap"),h[u++]=r(i,"iridescenceMap"),h[u++]=r(i,"iridescenceThicknessMap"),h[u++]=o(i,"iridescence",0),h[u++]=o(i,"iridescenceIOR",1.3);let s=o(i,"iridescenceThicknessRange",[100,400]);h[u++]=s[0],h[u++]=s[1],"specularColor"in i?(h[u++]=i.specularColor.r,h[u++]=i.specularColor.g,h[u++]=i.specularColor.b):(h[u++]=1,h[u++]=1,h[u++]=1),h[u++]=r(i,"specularColorMap"),h[u++]=o(i,"specularIntensity",1),h[u++]=r(i,"specularIntensityMap");let a=0===o(i,"thickness",0)&&o(i,"attenuationDistance",1/0)===1/0;if(h[u++]=Number(a),u++,"attenuationColor"in i?(h[u++]=i.attenuationColor.r,h[u++]=i.attenuationColor.g,h[u++]=i.attenuationColor.b):(h[u++]=1,h[u++]=1,h[u++]=1),h[u++]=o(i,"attenuationDistance",1/0),h[u++]=r(i,"alphaMap"),h[u++]=i.opacity,h[u++]=i.alphaTest,!a&&i.transmission>0)h[u++]=0;else switch(i.side){case n.FrontSide:h[u++]=1;break;case n.BackSide:h[u++]=-1;break;case n.DoubleSide:h[u++]=0}h[u++]=Number(o(i,"matte",!1)),h[u++]=Number(o(i,"castShadow",!0)),h[u++]=Number(i.vertexColors)|Number(i.flatShading)<<1,h[u++]=Number(i.transparent),u+=l(i,"map",h,u),u+=l(i,"metalnessMap",h,u),u+=l(i,"roughnessMap",h,u),u+=l(i,"transmissionMap",h,u),u+=l(i,"emissiveMap",h,u),u+=l(i,"normalMap",h,u),u+=l(i,"clearcoatMap",h,u),u+=l(i,"clearcoatNormalMap",h,u),u+=l(i,"clearcoatRoughnessMap",h,u),u+=l(i,"sheenColorMap",h,u),u+=l(i,"sheenRoughnessMap",h,u),u+=l(i,"iridescenceMap",h,u),u+=l(i,"iridescenceThicknessMap",h,u),u+=l(i,"specularColorMap",h,u),u+=l(i,"specularIntensityMap",h,u),u+=l(i,"alphaMap",h,u)}let m=(0,s.bufferToHash)(h.buffer);return this.hash!==m&&(this.hash=m,this.needsUpdate=!0,!0)}}}),s("9wqOU",function(t,r){function n(e,t){return e.uuid<t.uuid?1:e.uuid>t.uuid?-1:0}function i(e){return`${e.source.uuid}:${e.colorSpace}`}function o(e){return Array.from(new Set(e.map(e=>e.iesMap||null).filter(e=>e))).sort(n)}function s(e){let t=new Set;for(let r=0,n=e.length;r<n;r++){let n=e[r];for(let e in n){let r=n[e];r&&r.isTexture&&t.add(r)}}return(function(e){let t=new Set,r=[];for(let n=0,o=e.length;n<o;n++){let o=e[n],s=i(o);t.has(s)||(t.add(s),r.push(o))}return r})(Array.from(t)).sort(n)}function a(e){let t=[];return e.traverse(e=>{e.visible&&(e.isRectAreaLight||e.isSpotLight||e.isPointLight||e.isDirectionalLight)&&t.push(e)}),t.sort(n)}e(t.exports,"getTextureHash",()=>i),e(t.exports,"getIesTextures",()=>o),e(t.exports,"getTextures",()=>s),e(t.exports,"getLights",()=>a)}),s("1r4sY",function(t,r){e(t.exports,"material_struct",()=>n);let n=`

	struct Material {

		vec3 color;
		int map;

		float metalness;
		int metalnessMap;

		float roughness;
		int roughnessMap;

		float ior;
		float transmission;
		int transmissionMap;

		float emissiveIntensity;
		vec3 emissive;
		int emissiveMap;

		int normalMap;
		vec2 normalScale;

		float clearcoat;
		int clearcoatMap;
		int clearcoatNormalMap;
		vec2 clearcoatNormalScale;
		float clearcoatRoughness;
		int clearcoatRoughnessMap;

		int iridescenceMap;
		int iridescenceThicknessMap;
		float iridescence;
		float iridescenceIor;
		float iridescenceThicknessMinimum;
		float iridescenceThicknessMaximum;

		vec3 specularColor;
		int specularColorMap;

		float specularIntensity;
		int specularIntensityMap;
		bool thinFilm;

		vec3 attenuationColor;
		float attenuationDistance;

		int alphaMap;

		bool castShadow;
		float opacity;
		float alphaTest;

		float side;
		bool matte;

		float sheen;
		vec3 sheenColor;
		int sheenColorMap;
		float sheenRoughness;
		int sheenRoughnessMap;

		bool vertexColors;
		bool flatShading;
		bool transparent;
		bool fogVolume;

		mat3 mapTransform;
		mat3 metalnessMapTransform;
		mat3 roughnessMapTransform;
		mat3 transmissionMapTransform;
		mat3 emissiveMapTransform;
		mat3 normalMapTransform;
		mat3 clearcoatMapTransform;
		mat3 clearcoatNormalMapTransform;
		mat3 clearcoatRoughnessMapTransform;
		mat3 sheenColorMapTransform;
		mat3 sheenRoughnessMapTransform;
		mat3 iridescenceMapTransform;
		mat3 iridescenceThicknessMapTransform;
		mat3 specularColorMapTransform;
		mat3 specularIntensityMapTransform;
		mat3 alphaMapTransform;

	};

	mat3 readTextureTransform( sampler2D tex, uint index ) {

		mat3 textureTransform;

		vec4 row1 = texelFetch1D( tex, index );
		vec4 row2 = texelFetch1D( tex, index + 1u );

		textureTransform[0] = vec3(row1.r, row2.r, 0.0);
		textureTransform[1] = vec3(row1.g, row2.g, 0.0);
		textureTransform[2] = vec3(row1.b, row2.b, 1.0);

		return textureTransform;

	}

	Material readMaterialInfo( sampler2D tex, uint index ) {

		uint i = index * uint( MATERIAL_PIXELS );

		vec4 s0 = texelFetch1D( tex, i + 0u );
		vec4 s1 = texelFetch1D( tex, i + 1u );
		vec4 s2 = texelFetch1D( tex, i + 2u );
		vec4 s3 = texelFetch1D( tex, i + 3u );
		vec4 s4 = texelFetch1D( tex, i + 4u );
		vec4 s5 = texelFetch1D( tex, i + 5u );
		vec4 s6 = texelFetch1D( tex, i + 6u );
		vec4 s7 = texelFetch1D( tex, i + 7u );
		vec4 s8 = texelFetch1D( tex, i + 8u );
		vec4 s9 = texelFetch1D( tex, i + 9u );
		vec4 s10 = texelFetch1D( tex, i + 10u );
		vec4 s11 = texelFetch1D( tex, i + 11u );
		vec4 s12 = texelFetch1D( tex, i + 12u );
		vec4 s13 = texelFetch1D( tex, i + 13u );
		vec4 s14 = texelFetch1D( tex, i + 14u );

		Material m;
		m.color = s0.rgb;
		m.map = int( round( s0.a ) );

		m.metalness = s1.r;
		m.metalnessMap = int( round( s1.g ) );
		m.roughness = s1.b;
		m.roughnessMap = int( round( s1.a ) );

		m.ior = s2.r;
		m.transmission = s2.g;
		m.transmissionMap = int( round( s2.b ) );
		m.emissiveIntensity = s2.a;

		m.emissive = s3.rgb;
		m.emissiveMap = int( round( s3.a ) );

		m.normalMap = int( round( s4.r ) );
		m.normalScale = s4.gb;

		m.clearcoat = s4.a;
		m.clearcoatMap = int( round( s5.r ) );
		m.clearcoatRoughness = s5.g;
		m.clearcoatRoughnessMap = int( round( s5.b ) );
		m.clearcoatNormalMap = int( round( s5.a ) );
		m.clearcoatNormalScale = s6.rg;

		m.sheen = s6.a;
		m.sheenColor = s7.rgb;
		m.sheenColorMap = int( round( s7.a ) );
		m.sheenRoughness = s8.r;
		m.sheenRoughnessMap = int( round( s8.g ) );

		m.iridescenceMap = int( round( s8.b ) );
		m.iridescenceThicknessMap = int( round( s8.a ) );
		m.iridescence = s9.r;
		m.iridescenceIor = s9.g;
		m.iridescenceThicknessMinimum = s9.b;
		m.iridescenceThicknessMaximum = s9.a;

		m.specularColor = s10.rgb;
		m.specularColorMap = int( round( s10.a ) );

		m.specularIntensity = s11.r;
		m.specularIntensityMap = int( round( s11.g ) );
		m.thinFilm = bool( s11.b );

		m.attenuationColor = s12.rgb;
		m.attenuationDistance = s12.a;

		m.alphaMap = int( round( s13.r ) );

		m.opacity = s13.g;
		m.alphaTest = s13.b;
		m.side = s13.a;

		m.matte = bool( s14.r );
		m.castShadow = bool( s14.g );
		m.vertexColors = bool( int( s14.b ) & 1 );
		m.flatShading = bool( int( s14.b ) & 2 );
		m.fogVolume = bool( int( s14.b ) & 4 );
		m.transparent = bool( s14.a );

		uint firstTextureTransformIdx = i + 15u;

		// mat3( 1.0 ) is an identity matrix
		m.mapTransform = m.map == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx );
		m.metalnessMapTransform = m.metalnessMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 2u );
		m.roughnessMapTransform = m.roughnessMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 4u );
		m.transmissionMapTransform = m.transmissionMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 6u );
		m.emissiveMapTransform = m.emissiveMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 8u );
		m.normalMapTransform = m.normalMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 10u );
		m.clearcoatMapTransform = m.clearcoatMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 12u );
		m.clearcoatNormalMapTransform = m.clearcoatNormalMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 14u );
		m.clearcoatRoughnessMapTransform = m.clearcoatRoughnessMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 16u );
		m.sheenColorMapTransform = m.sheenColorMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 18u );
		m.sheenRoughnessMapTransform = m.sheenRoughnessMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 20u );
		m.iridescenceMapTransform = m.iridescenceMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 22u );
		m.iridescenceThicknessMapTransform = m.iridescenceThicknessMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 24u );
		m.specularColorMapTransform = m.specularColorMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 26u );
		m.specularIntensityMapTransform = m.specularIntensityMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 28u );
		m.alphaMapTransform = m.alphaMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 30u );

		return m;

	}

`}),s("cp6U0",function(t,r){e(t.exports,"shape_sampling_functions",()=>n);let n=`

	vec3 sampleHemisphere( vec3 n, vec2 uv ) {

		// https://www.rorydriscoll.com/2009/01/07/better-sampling/
		// https://graphics.pixar.com/library/OrthonormalB/paper.pdf
		float sign = n.z == 0.0 ? 1.0 : sign( n.z );
		float a = - 1.0 / ( sign + n.z );
		float b = n.x * n.y * a;
		vec3 b1 = vec3( 1.0 + sign * n.x * n.x * a, sign * b, - sign * n.x );
		vec3 b2 = vec3( b, sign + n.y * n.y * a, - n.y );

		float r = sqrt( uv.x );
		float theta = 2.0 * PI * uv.y;
		float x = r * cos( theta );
		float y = r * sin( theta );
		return x * b1 + y * b2 + sqrt( 1.0 - uv.x ) * n;

	}

	vec2 sampleTriangle( vec2 a, vec2 b, vec2 c, vec2 r ) {

		// get the edges of the triangle and the diagonal across the
		// center of the parallelogram
		vec2 e1 = a - b;
		vec2 e2 = c - b;
		vec2 diag = normalize( e1 + e2 );

		// pick the point in the parallelogram
		if ( r.x + r.y > 1.0 ) {

			r = vec2( 1.0 ) - r;

		}

		return e1 * r.x + e2 * r.y;

	}

	vec2 sampleCircle( vec2 uv ) {

		float angle = 2.0 * PI * uv.x;
		float radius = sqrt( uv.y );
		return vec2( cos( angle ), sin( angle ) ) * radius;

	}

	vec3 sampleSphere( vec2 uv ) {

		float u = ( uv.x - 0.5 ) * 2.0;
		float t = uv.y * PI * 2.0;
		float f = sqrt( 1.0 - u * u );

		return vec3( f * cos( t ), f * sin( t ), u );

	}

	vec2 sampleRegularPolygon( int sides, vec3 uvw ) {

		sides = max( sides, 3 );

		vec3 r = uvw;
		float anglePerSegment = 2.0 * PI / float( sides );
		float segment = floor( float( sides ) * r.x );

		float angle1 = anglePerSegment * segment;
		float angle2 = angle1 + anglePerSegment;
		vec2 a = vec2( sin( angle1 ), cos( angle1 ) );
		vec2 b = vec2( 0.0, 0.0 );
		vec2 c = vec2( sin( angle2 ), cos( angle2 ) );

		return sampleTriangle( a, b, c, r.yz );

	}

	// samples an aperture shape with the given number of sides. 0 means circle
	vec2 sampleAperture( int blades, vec3 uvw ) {

		return blades == 0 ?
			sampleCircle( uvw.xy ) :
			sampleRegularPolygon( blades, uvw );

	}


`}),s("kmALz",function(t,r){e(t.exports,"pcg_functions",()=>n);let n=`

	// https://www.shadertoy.com/view/wltcRS
	uvec4 WHITE_NOISE_SEED;

	void rng_initialize( vec2 p, int frame ) {

		// white noise seed
		WHITE_NOISE_SEED = uvec4( p, uint( frame ), uint( p.x ) + uint( p.y ) );

	}

	// https://www.pcg-random.org/
	void pcg4d( inout uvec4 v ) {

		v = v * 1664525u + 1013904223u;
		v.x += v.y * v.w;
		v.y += v.z * v.x;
		v.z += v.x * v.y;
		v.w += v.y * v.z;
		v = v ^ ( v >> 16u );
		v.x += v.y*v.w;
		v.y += v.z*v.x;
		v.z += v.x*v.y;
		v.w += v.y*v.z;

	}

	// returns [ 0, 1 ]
	float pcgRand() {

		pcg4d( WHITE_NOISE_SEED );
		return float( WHITE_NOISE_SEED.x ) / float( 0xffffffffu );

	}

	vec2 pcgRand2() {

		pcg4d( WHITE_NOISE_SEED );
		return vec2( WHITE_NOISE_SEED.xy ) / float(0xffffffffu);

	}

	vec3 pcgRand3() {

		pcg4d( WHITE_NOISE_SEED );
		return vec3( WHITE_NOISE_SEED.xyz ) / float( 0xffffffffu );

	}

	vec4 pcgRand4() {

		pcg4d( WHITE_NOISE_SEED );
		return vec4( WHITE_NOISE_SEED ) / float( 0xffffffffu );

	}
`});
//# sourceMappingURL=aoRender.d33f21b3.js.map
