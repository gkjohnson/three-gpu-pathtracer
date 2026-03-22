import{Y as Bn,a4 as Qn,U as mt,aQ as Ze,c as K,B as X,n as C,bA as tt,ar as Pn,V as ot,bB as At,m as j,bC as Dn,G as Cn,bD as En,aq as Jn,ag as Se,b2 as Rt,F as It,a as ie,u as st,a$ as pe,aU as Ke,bE as ti,b1 as Qe,b0 as ei,R as Ut,bF as Ie,bG as Fn,bH as ni,bp as ii,aV as si,as as ri,aK as Ve,J as oi,x as Je}from"./MaterialBase-BHiBH7Mr.js";const ai=new Qn(-1,1,1,-1,0,1);class ci extends mt{constructor(){super(),this.setAttribute("position",new Ze([-1,3,0,-1,-1,0,3,-1,0],3)),this.setAttribute("uv",new Ze([0,2,0,0,2,0],2))}}const li=new ci;class ks{constructor(t){this._mesh=new Bn(li,t)}dispose(){this._mesh.geometry.dispose()}render(t){t.render(this._mesh,ai)}get material(){return this._mesh.material}set material(t){this._mesh.material=t}}const zn=0,ui=1,Rn=2,tn=2,me=1.25,en=1,L=32,k=L/4,He=65535,fi=He<<16,di=Math.pow(2,-24),Oe=Symbol("SKIP_GENERATION"),Nn={strategy:zn,maxDepth:40,maxLeafSize:10,useSharedArrayBuffer:!1,setBoundingBox:!0,onProgress:null,indirect:!1,verbose:!0,range:null,[Oe]:!1};function z(n,t,e){return e.min.x=t[n],e.min.y=t[n+1],e.min.z=t[n+2],e.max.x=t[n+3],e.max.y=t[n+4],e.max.z=t[n+5],e}function nn(n){let t=-1,e=-1/0;for(let s=0;s<3;s++){const r=n[s+3]-n[s];r>e&&(e=r,t=s)}return t}function sn(n,t){t.set(n)}function rn(n,t,e){let s,r;for(let a=0;a<3;a++){const i=a+3;s=n[a],r=t[a],e[a]=s<r?s:r,s=n[i],r=t[i],e[i]=s>r?s:r}}function Lt(n,t,e){for(let s=0;s<3;s++){const r=t[n+2*s],a=t[n+2*s+1],i=r-a,l=r+a;i<e[s]&&(e[s]=i),l>e[s+3]&&(e[s+3]=l)}}function _t(n){const t=n[3]-n[0],e=n[4]-n[1],s=n[5]-n[2];return 2*(t*e+e*s+s*t)}function U(n,t){return t[n+15]===He}function W(n,t){return t[n+6]}function q(n,t){return t[n+14]}function V(n){return n+k}function H(n,t){const e=t[n+6];return n+e*k}function re(n,t){return t[n+7]}function he(n,t,e,s,r){let a=1/0,i=1/0,l=1/0,c=-1/0,d=-1/0,f=-1/0,u=1/0,o=1/0,m=1/0,g=-1/0,T=-1/0,p=-1/0;const v=n.offset||0;for(let h=(t-v)*6,x=(t+e-v)*6;h<x;h+=6){const y=n[h+0],b=n[h+1],w=y-b,A=y+b;w<a&&(a=w),A>c&&(c=A),y<u&&(u=y),y>g&&(g=y);const I=n[h+2],_=n[h+3],M=I-_,B=I+_;M<i&&(i=M),B>d&&(d=B),I<o&&(o=I),I>T&&(T=I);const S=n[h+4],P=n[h+5],D=S-P,E=S+P;D<l&&(l=D),E>f&&(f=E),S<m&&(m=S),S>p&&(p=S)}s[0]=a,s[1]=i,s[2]=l,s[3]=c,s[4]=d,s[5]=f,r[0]=u,r[1]=o,r[2]=m,r[3]=g,r[4]=T,r[5]=p}const Q=32,pi=(n,t)=>n.candidate-t.candidate,nt=new Array(Q).fill().map(()=>({count:0,bounds:new Float32Array(6),rightCacheBounds:new Float32Array(6),leftCacheBounds:new Float32Array(6),candidate:0})),Vt=new Float32Array(6);function mi(n,t,e,s,r,a){let i=-1,l=0;if(a===zn)i=nn(t),i!==-1&&(l=(t[i]+t[i+3])/2);else if(a===ui)i=nn(n),i!==-1&&(l=hi(e,s,r,i));else if(a===Rn){const c=_t(n);let d=me*r;const f=e.offset||0,u=(s-f)*6,o=(s+r-f)*6;for(let m=0;m<3;m++){const g=t[m],v=(t[m+3]-g)/Q;if(r<Q/4){const h=[...nt];h.length=r;let x=0;for(let b=u;b<o;b+=6,x++){const w=h[x];w.candidate=e[b+2*m],w.count=0;const{bounds:A,leftCacheBounds:I,rightCacheBounds:_}=w;for(let M=0;M<3;M++)_[M]=1/0,_[M+3]=-1/0,I[M]=1/0,I[M+3]=-1/0,A[M]=1/0,A[M+3]=-1/0;Lt(b,e,A)}h.sort(pi);let y=r;for(let b=0;b<y;b++){const w=h[b];for(;b+1<y&&h[b+1].candidate===w.candidate;)h.splice(b+1,1),y--}for(let b=u;b<o;b+=6){const w=e[b+2*m];for(let A=0;A<y;A++){const I=h[A];w>=I.candidate?Lt(b,e,I.rightCacheBounds):(Lt(b,e,I.leftCacheBounds),I.count++)}}for(let b=0;b<y;b++){const w=h[b],A=w.count,I=r-w.count,_=w.leftCacheBounds,M=w.rightCacheBounds;let B=0;A!==0&&(B=_t(_)/c);let S=0;I!==0&&(S=_t(M)/c);const P=en+me*(B*A+S*I);P<d&&(i=m,d=P,l=w.candidate)}}else{for(let y=0;y<Q;y++){const b=nt[y];b.count=0,b.candidate=g+v+y*v;const w=b.bounds;for(let A=0;A<3;A++)w[A]=1/0,w[A+3]=-1/0}for(let y=u;y<o;y+=6){let A=~~((e[y+2*m]-g)/v);A>=Q&&(A=Q-1);const I=nt[A];I.count++,Lt(y,e,I.bounds)}const h=nt[Q-1];sn(h.bounds,h.rightCacheBounds);for(let y=Q-2;y>=0;y--){const b=nt[y],w=nt[y+1];rn(b.bounds,w.rightCacheBounds,b.rightCacheBounds)}let x=0;for(let y=0;y<Q-1;y++){const b=nt[y],w=b.count,A=b.bounds,_=nt[y+1].rightCacheBounds;w!==0&&(x===0?sn(A,Vt):rn(A,Vt,Vt)),x+=w;let M=0,B=0;x!==0&&(M=_t(Vt)/c);const S=r-x;S!==0&&(B=_t(_)/c);const P=en+me*(M*x+B*S);P<d&&(i=m,d=P,l=b.candidate)}}}}else console.warn(`BVH: Invalid build strategy value ${a} used.`);return{axis:i,pos:l}}function hi(n,t,e,s){let r=0;const a=n.offset;for(let i=t,l=t+e;i<l;i++)r+=n[(i-a)*6+s*2];return r/e}class xe{constructor(){this.boundingData=new Float32Array(6)}}function xi(n,t,e,s,r,a){let i=s,l=s+r-1;const c=a.pos,d=a.axis*2,f=e.offset||0;for(;;){for(;i<=l&&e[(i-f)*6+d]<c;)i++;for(;i<=l&&e[(l-f)*6+d]>=c;)l--;if(i<l){for(let u=0;u<t;u++){let o=n[i*t+u];n[i*t+u]=n[l*t+u],n[l*t+u]=o}for(let u=0;u<6;u++){const o=i-f,m=l-f,g=e[o*6+u];e[o*6+u]=e[m*6+u],e[m*6+u]=g}i++,l--}else return i}}let Un,ne,_e,kn;const yi=Math.pow(2,32);function Be(n){return"count"in n?1:1+Be(n.left)+Be(n.right)}function gi(n,t,e){return Un=new Float32Array(e),ne=new Uint32Array(e),_e=new Uint16Array(e),kn=new Uint8Array(e),Pe(n,t)}function Pe(n,t){const e=n/4,s=n/2,r="count"in t,a=t.boundingData;for(let i=0;i<6;i++)Un[e+i]=a[i];if(r)return t.buffer?(kn.set(new Uint8Array(t.buffer),n),n+t.buffer.byteLength):(ne[e+6]=t.offset,_e[s+14]=t.count,_e[s+15]=He,n+L);{const{left:i,right:l,splitAxis:c}=t,d=n+L;let f=Pe(d,i);const u=n/L,m=f/L-u;if(m>yi)throw new Error("MeshBVH: Cannot store relative child node offset greater than 32 bits.");return ne[e+6]=m,ne[e+7]=c,Pe(f,l)}}function bi(n,t,e,s,r){const{maxDepth:a,verbose:i,maxLeafSize:l,strategy:c,onProgress:d}=r,f=n.primitiveBuffer,u=n.primitiveBufferStride,o=new Float32Array(6);let m=!1;const g=new xe;return he(t,e,s,g.boundingData,o),p(g,e,s,o),g;function T(v){d&&d(v/s)}function p(v,h,x,y=null,b=0){if(!m&&b>=a&&(m=!0,i&&console.warn(`BVH: Max depth of ${a} reached when generating BVH. Consider increasing maxDepth.`)),x<=l||b>=a)return T(h+x),v.offset=h,v.count=x,v;const w=mi(v.boundingData,y,t,h,x,c);if(w.axis===-1)return T(h+x),v.offset=h,v.count=x,v;const A=xi(f,u,t,h,x,w);if(A===h||A===h+x)T(h+x),v.offset=h,v.count=x;else{v.splitAxis=w.axis;const I=new xe,_=h,M=A-h;v.left=I,he(t,_,M,I.boundingData,o),p(I,_,M,o,b+1);const B=new xe,S=A,P=x-M;v.right=B,he(t,S,P,B.boundingData,o),p(B,S,P,o,b+1)}return v}}function vi(n,t){const e=t.useSharedArrayBuffer?SharedArrayBuffer:ArrayBuffer,s=n.getRootRanges(t.range),r=s[0],a=s[s.length-1],i={offset:r.offset,count:a.offset+a.count-r.offset},l=new Float32Array(6*i.count);l.offset=i.offset,n.computePrimitiveBounds(i.offset,i.count,l),n._roots=s.map(c=>{const d=bi(n,l,c.offset,c.count,t),f=Be(d),u=new e(L*f);return gi(0,d,u),u})}class We{constructor(t){this._getNewPrimitive=t,this._primitives=[]}getPrimitive(){const t=this._primitives;return t.length===0?this._getNewPrimitive():t.pop()}releasePrimitive(t){this._primitives.push(t)}}class Ti{constructor(){this.float32Array=null,this.uint16Array=null,this.uint32Array=null;const t=[];let e=null;this.setBuffer=s=>{e&&t.push(e),e=s,this.float32Array=new Float32Array(s),this.uint16Array=new Uint16Array(s),this.uint32Array=new Uint32Array(s)},this.clearBuffer=()=>{e=null,this.float32Array=null,this.uint16Array=null,this.uint32Array=null,t.length!==0&&this.setBuffer(t.pop())}}}const F=new Ti;let rt,St;const xt=[],Ht=new We(()=>new K);function wi(n,t,e,s,r,a){rt=Ht.getPrimitive(),St=Ht.getPrimitive(),xt.push(rt,St),F.setBuffer(n._roots[t]);const i=De(0,n.geometry,e,s,r,a);F.clearBuffer(),Ht.releasePrimitive(rt),Ht.releasePrimitive(St),xt.pop(),xt.pop();const l=xt.length;return l>0&&(St=xt[l-1],rt=xt[l-2]),i}function De(n,t,e,s,r=null,a=0,i=0){const{float32Array:l,uint16Array:c,uint32Array:d}=F;let f=n*2;if(U(f,c)){const o=W(n,d),m=q(f,c);return z(n,l,rt),s(o,m,!1,i,a+n/k,rt)}else{let M=function(S){const{uint16Array:P,uint32Array:D}=F;let E=S*2;for(;!U(E,P);)S=V(S),E=S*2;return W(S,D)},B=function(S){const{uint16Array:P,uint32Array:D}=F;let E=S*2;for(;!U(E,P);)S=H(S,D),E=S*2;return W(S,D)+q(E,P)};const o=V(n),m=H(n,d);let g=o,T=m,p,v,h,x;if(r&&(h=rt,x=St,z(g,l,h),z(T,l,x),p=r(h),v=r(x),v<p)){g=m,T=o;const S=p;p=v,v=S,h=x}h||(h=rt,z(g,l,h));const y=U(g*2,c),b=e(h,y,p,i+1,a+g/k);let w;if(b===tn){const S=M(g),D=B(g)-S;w=s(S,D,!0,i+1,a+g/k,h)}else w=b&&De(g,t,e,s,r,a,i+1);if(w)return!0;x=St,z(T,l,x);const A=U(T*2,c),I=e(x,A,v,i+1,a+T/k);let _;if(I===tn){const S=M(T),D=B(T)-S;_=s(S,D,!0,i+1,a+T/k,x)}else _=I&&De(T,t,e,s,r,a,i+1);return!!_}}function oe(n){return n.index?n.index.count:n.attributes.position.count}function ae(n){return oe(n)/3}function Ln(n,t=ArrayBuffer){return n>65535?new Uint32Array(new t(4*n)):new Uint16Array(new t(2*n))}function Ai(n,t){if(!n.index){const e=n.attributes.position.count,s=t.useSharedArrayBuffer?SharedArrayBuffer:ArrayBuffer,r=Ln(e,s);n.setIndex(new X(r,1));for(let a=0;a<e;a++)r[a]=a}}function Mi(n,t,e){const s=oe(n)/e,r=t||n.drawRange,a=r.start/e,i=(r.start+r.count)/e,l=Math.max(0,a),c=Math.min(s,i)-l;return{offset:Math.floor(l),count:Math.floor(c)}}function Si(n,t){return n.groups.map(e=>({offset:e.start/t,count:e.count/t}))}function Ce(n,t,e){const s=Mi(n,t,e),r=Si(n,e);if(!r.length)return[s];const a=[],i=s.offset,l=s.offset+s.count,c=oe(n)/e,d=[];for(const o of r){const{offset:m,count:g}=o,T=m,p=isFinite(g)?g:c-m,v=m+p;T<l&&v>i&&(d.push({pos:Math.max(i,T),isStart:!0}),d.push({pos:Math.min(l,v),isStart:!1}))}d.sort((o,m)=>o.pos!==m.pos?o.pos-m.pos:o.type==="end"?-1:1);let f=0,u=null;for(const o of d){const m=o.pos;f!==0&&m!==u&&a.push({offset:u,count:m-u}),f+=o.isStart?1:-1,u=m}return a}const on=new K;class Ii{constructor(){this._roots=null,this.primitiveBuffer=null,this.primitiveBufferStride=null}init(t){t={...Nn,...t},vi(this,t)}getRootRanges(t){return Ce(this.geometry,t,this.primitiveStride)}raycastObject3D(){throw new Error("BVH: raycastObject3D() not implemented")}shiftPrimitiveOffsets(t){const e=this._indirectBuffer;if(e)for(let s=0,r=e.length;s<r;s++)e[s]+=t;else{const s=this._roots;for(let r=0;r<s.length;r++){const a=s[r],i=new Uint32Array(a),l=new Uint16Array(a),c=a.byteLength/L;for(let d=0;d<c;d++){const f=k*d,u=2*f;U(u,l)&&(i[f+6]+=t)}}}}traverse(t,e=0){const s=this._roots[e],r=new Uint32Array(s),a=new Uint16Array(s);i(0);function i(l,c=0){const d=l*2,f=U(d,a);if(f){const u=r[l+6],o=a[d+14];t(c,f,new Float32Array(s,l*4,6),u,o)}else{const u=V(l),o=H(l,r),m=re(l,r);t(c,f,new Float32Array(s,l*4,6),m)||(i(u,c+1),i(o,c+1))}}}getBoundingBox(t){return t.makeEmpty(),this._roots.forEach(s=>{z(0,new Float32Array(s),on),t.union(on)}),t}shapecast(t){let{boundsTraverseOrder:e,intersectsBounds:s,intersectsRange:r,intersectsPrimitive:a,scratchPrimitive:i,iterate:l}=t;if(r&&a){const u=r;r=(o,m,g,T,p)=>u(o,m,g,T,p)?!0:l(o,m,this,a,g,T,i)}else r||(a?r=(u,o,m,g)=>l(u,o,this,a,m,g,i):r=(u,o,m)=>m);let c=!1,d=0;const f=this._roots;for(let u=0,o=f.length;u<o;u++){const m=f[u];if(c=wi(this,u,s,r,e,d),c)break;d+=m.byteLength/L}return c}}class et{constructor(){this.min=1/0,this.max=-1/0}setFromPointsField(t,e){let s=1/0,r=-1/0;for(let a=0,i=t.length;a<i;a++){const c=t[a][e];s=c<s?c:s,r=c>r?c:r}this.min=s,this.max=r}setFromPoints(t,e){let s=1/0,r=-1/0;for(let a=0,i=e.length;a<i;a++){const l=e[a],c=t.dot(l);s=c<s?c:s,r=c>r?c:r}this.min=s,this.max=r}isSeparated(t){return this.min>t.max||t.min>this.max}}et.prototype.setFromBox=(function(){const n=new C;return function(e,s){const r=s.min,a=s.max;let i=1/0,l=-1/0;for(let c=0;c<=1;c++)for(let d=0;d<=1;d++)for(let f=0;f<=1;f++){n.x=r.x*c+a.x*(1-c),n.y=r.y*d+a.y*(1-d),n.z=r.z*f+a.z*(1-f);const u=e.dot(n);i=Math.min(u,i),l=Math.max(u,l)}this.min=i,this.max=l}})();const _i=(function(){const n=new C,t=new C,e=new C;return function(r,a,i){const l=r.start,c=n,d=a.start,f=t;e.subVectors(l,d),n.subVectors(r.end,r.start),t.subVectors(a.end,a.start);const u=e.dot(f),o=f.dot(c),m=f.dot(f),g=e.dot(c),p=c.dot(c)*m-o*o;let v,h;p!==0?v=(u*o-g*m)/p:v=0,h=(u+v*o)/m,i.x=v,i.y=h}})(),qe=(function(){const n=new ot,t=new C,e=new C;return function(r,a,i,l){_i(r,a,n);let c=n.x,d=n.y;if(c>=0&&c<=1&&d>=0&&d<=1){r.at(c,i),a.at(d,l);return}else if(c>=0&&c<=1){d<0?a.at(0,l):a.at(1,l),r.closestPointToPoint(l,!0,i);return}else if(d>=0&&d<=1){c<0?r.at(0,i):r.at(1,i),a.closestPointToPoint(i,!0,l);return}else{let f;c<0?f=r.start:f=r.end;let u;d<0?u=a.start:u=a.end;const o=t,m=e;if(r.closestPointToPoint(u,!0,t),a.closestPointToPoint(f,!0,e),o.distanceToSquared(u)<=m.distanceToSquared(f)){i.copy(o),l.copy(u);return}else{i.copy(f),l.copy(m);return}}}})(),Bi=(function(){const n=new C,t=new C,e=new Pn,s=new tt;return function(a,i){const{radius:l,center:c}=a,{a:d,b:f,c:u}=i;if(s.start=d,s.end=f,s.closestPointToPoint(c,!0,n).distanceTo(c)<=l||(s.start=d,s.end=u,s.closestPointToPoint(c,!0,n).distanceTo(c)<=l)||(s.start=f,s.end=u,s.closestPointToPoint(c,!0,n).distanceTo(c)<=l))return!0;const T=i.getPlane(e);if(Math.abs(T.distanceToPoint(c))<=l){const v=T.projectPoint(c,t);if(i.containsPoint(v))return!0}return!1}})(),Pi=["x","y","z"],J=1e-15,an=J*J;function $(n){return Math.abs(n)<J}class Z extends At{constructor(...t){super(...t),this.isExtendedTriangle=!0,this.satAxes=new Array(4).fill().map(()=>new C),this.satBounds=new Array(4).fill().map(()=>new et),this.points=[this.a,this.b,this.c],this.plane=new Pn,this.isDegenerateIntoSegment=!1,this.isDegenerateIntoPoint=!1,this.degenerateSegment=new tt,this.needsUpdate=!0}intersectsSphere(t){return Bi(t,this)}update(){const t=this.a,e=this.b,s=this.c,r=this.points,a=this.satAxes,i=this.satBounds,l=a[0],c=i[0];this.getNormal(l),c.setFromPoints(l,r);const d=a[1],f=i[1];d.subVectors(t,e),f.setFromPoints(d,r);const u=a[2],o=i[2];u.subVectors(e,s),o.setFromPoints(u,r);const m=a[3],g=i[3];m.subVectors(s,t),g.setFromPoints(m,r);const T=d.length(),p=u.length(),v=m.length();this.isDegenerateIntoPoint=!1,this.isDegenerateIntoSegment=!1,T<J?p<J||v<J?this.isDegenerateIntoPoint=!0:(this.isDegenerateIntoSegment=!0,this.degenerateSegment.start.copy(t),this.degenerateSegment.end.copy(s)):p<J?v<J?this.isDegenerateIntoPoint=!0:(this.isDegenerateIntoSegment=!0,this.degenerateSegment.start.copy(e),this.degenerateSegment.end.copy(t)):v<J&&(this.isDegenerateIntoSegment=!0,this.degenerateSegment.start.copy(s),this.degenerateSegment.end.copy(e)),this.plane.setFromNormalAndCoplanarPoint(l,t),this.needsUpdate=!1}}Z.prototype.closestPointToSegment=(function(){const n=new C,t=new C,e=new tt;return function(r,a=null,i=null){const{start:l,end:c}=r,d=this.points;let f,u=1/0;for(let o=0;o<3;o++){const m=(o+1)%3;e.start.copy(d[o]),e.end.copy(d[m]),qe(e,r,n,t),f=n.distanceToSquared(t),f<u&&(u=f,a&&a.copy(n),i&&i.copy(t))}return this.closestPointToPoint(l,n),f=l.distanceToSquared(n),f<u&&(u=f,a&&a.copy(n),i&&i.copy(l)),this.closestPointToPoint(c,n),f=c.distanceToSquared(n),f<u&&(u=f,a&&a.copy(n),i&&i.copy(c)),Math.sqrt(u)}})();Z.prototype.intersectsTriangle=(function(){const n=new Z,t=new et,e=new et,s=new C,r=new C,a=new C,i=new C,l=new tt,c=new tt,d=new C,f=new ot,u=new ot;function o(x,y,b,w){const A=s;!x.isDegenerateIntoPoint&&!x.isDegenerateIntoSegment?A.copy(x.plane.normal):A.copy(y.plane.normal);const I=x.satBounds,_=x.satAxes;for(let S=1;S<4;S++){const P=I[S],D=_[S];if(t.setFromPoints(D,y.points),P.isSeparated(t)||(i.copy(A).cross(D),t.setFromPoints(i,x.points),e.setFromPoints(i,y.points),t.isSeparated(e)))return!1}const M=y.satBounds,B=y.satAxes;for(let S=1;S<4;S++){const P=M[S],D=B[S];if(t.setFromPoints(D,x.points),P.isSeparated(t)||(i.crossVectors(A,D),t.setFromPoints(i,x.points),e.setFromPoints(i,y.points),t.isSeparated(e)))return!1}return b&&(w||console.warn("ExtendedTriangle.intersectsTriangle: Triangles are coplanar which does not support an output edge. Setting edge to 0, 0, 0."),b.start.set(0,0,0),b.end.set(0,0,0)),!0}function m(x,y,b,w,A,I,_,M,B,S,P){let D=_/(_-M);S.x=w+(A-w)*D,P.start.subVectors(y,x).multiplyScalar(D).add(x),D=_/(_-B),S.y=w+(I-w)*D,P.end.subVectors(b,x).multiplyScalar(D).add(x)}function g(x,y,b,w,A,I,_,M,B,S,P){if(A>0)m(x.c,x.a,x.b,w,y,b,B,_,M,S,P);else if(I>0)m(x.b,x.a,x.c,b,y,w,M,_,B,S,P);else if(M*B>0||_!=0)m(x.a,x.b,x.c,y,b,w,_,M,B,S,P);else if(M!=0)m(x.b,x.a,x.c,b,y,w,M,_,B,S,P);else if(B!=0)m(x.c,x.a,x.b,w,y,b,B,_,M,S,P);else return!0;return!1}function T(x,y,b,w){const A=y.degenerateSegment,I=x.plane.distanceToPoint(A.start),_=x.plane.distanceToPoint(A.end);return $(I)?$(_)?o(x,y,b,w):(b&&(b.start.copy(A.start),b.end.copy(A.start)),x.containsPoint(A.start)):$(_)?(b&&(b.start.copy(A.end),b.end.copy(A.end)),x.containsPoint(A.end)):x.plane.intersectLine(A,s)!=null?(b&&(b.start.copy(s),b.end.copy(s)),x.containsPoint(s)):!1}function p(x,y,b){const w=y.a;return $(x.plane.distanceToPoint(w))&&x.containsPoint(w)?(b&&(b.start.copy(w),b.end.copy(w)),!0):!1}function v(x,y,b){const w=x.degenerateSegment,A=y.a;return w.closestPointToPoint(A,!0,s),A.distanceToSquared(s)<an?(b&&(b.start.copy(A),b.end.copy(A)),!0):!1}function h(x,y,b,w){if(x.isDegenerateIntoSegment)if(y.isDegenerateIntoSegment){const A=x.degenerateSegment,I=y.degenerateSegment,_=r,M=a;A.delta(_),I.delta(M);const B=s.subVectors(I.start,A.start),S=_.x*M.y-_.y*M.x;if($(S))return!1;const P=(B.x*M.y-B.y*M.x)/S,D=-(_.x*B.y-_.y*B.x)/S;if(P<0||P>1||D<0||D>1)return!1;const E=A.start.z+_.z*P,R=I.start.z+M.z*D;return $(E-R)?(b&&(b.start.copy(A.start).addScaledVector(_,P),b.end.copy(A.start).addScaledVector(_,P)),!0):!1}else return y.isDegenerateIntoPoint?v(x,y,b):T(y,x,b,w);else{if(x.isDegenerateIntoPoint)return y.isDegenerateIntoPoint?y.a.distanceToSquared(x.a)<an?(b&&(b.start.copy(x.a),b.end.copy(x.a)),!0):!1:y.isDegenerateIntoSegment?v(y,x,b):p(y,x,b);if(y.isDegenerateIntoPoint)return p(x,y,b);if(y.isDegenerateIntoSegment)return T(x,y,b,w)}}return function(y,b=null,w=!1){this.needsUpdate&&this.update(),y.isExtendedTriangle?y.needsUpdate&&y.update():(n.copy(y),n.update(),y=n);const A=h(this,y,b,w);if(A!==void 0)return A;const I=this.plane,_=y.plane;let M=_.distanceToPoint(this.a),B=_.distanceToPoint(this.b),S=_.distanceToPoint(this.c);$(M)&&(M=0),$(B)&&(B=0),$(S)&&(S=0);const P=M*B,D=M*S;if(P>0&&D>0)return!1;let E=I.distanceToPoint(y.a),R=I.distanceToPoint(y.b),kt=I.distanceToPoint(y.c);$(E)&&(E=0),$(R)&&(R=0),$(kt)&&(kt=0);const Ge=E*R,Ye=E*kt;if(Ge>0&&Ye>0)return!1;r.copy(I.normal),a.copy(_.normal);const le=r.cross(a);let ue=0,fe=Math.abs(le.x);const je=Math.abs(le.y);je>fe&&(fe=je,ue=1),Math.abs(le.z)>fe&&(ue=2);const ht=Pi[ue],Xn=this.a[ht],Gn=this.b[ht],Yn=this.c[ht],jn=y.a[ht],Zn=y.b[ht],Kn=y.c[ht];if(g(this,Xn,Gn,Yn,P,D,M,B,S,f,l))return o(this,y,b,w);if(g(y,jn,Zn,Kn,Ge,Ye,E,R,kt,u,c))return o(this,y,b,w);if(f.y<f.x){const de=f.y;f.y=f.x,f.x=de,d.copy(l.start),l.start.copy(l.end),l.end.copy(d)}if(u.y<u.x){const de=u.y;u.y=u.x,u.x=de,d.copy(c.start),c.start.copy(c.end),c.end.copy(d)}return f.y<u.x||u.y<f.x?!1:(b&&(u.x>f.x?b.start.copy(c.start):b.start.copy(l.start),u.y<f.y?b.end.copy(c.end):b.end.copy(l.end)),!0)}})();Z.prototype.distanceToPoint=(function(){const n=new C;return function(e){return this.closestPointToPoint(e,n),e.distanceTo(n)}})();Z.prototype.distanceToTriangle=(function(){const n=new C,t=new C,e=["a","b","c"],s=new tt,r=new tt;return function(i,l=null,c=null){const d=l||c?s:null;if(this.intersectsTriangle(i,d))return(l||c)&&(l&&d.getCenter(l),c&&d.getCenter(c)),0;let f=1/0;for(let u=0;u<3;u++){let o;const m=e[u],g=i[m];this.closestPointToPoint(g,n),o=g.distanceToSquared(n),o<f&&(f=o,l&&l.copy(n),c&&c.copy(g));const T=this[m];i.closestPointToPoint(T,n),o=T.distanceToSquared(n),o<f&&(f=o,l&&l.copy(T),c&&c.copy(n))}for(let u=0;u<3;u++){const o=e[u],m=e[(u+1)%3];s.set(this[o],this[m]);for(let g=0;g<3;g++){const T=e[g],p=e[(g+1)%3];r.set(i[T],i[p]),qe(s,r,n,t);const v=n.distanceToSquared(t);v<f&&(f=v,l&&l.copy(n),c&&c.copy(t))}}return Math.sqrt(f)}})();class O{constructor(t,e,s){this.isOrientedBox=!0,this.min=new C,this.max=new C,this.matrix=new j,this.invMatrix=new j,this.points=new Array(8).fill().map(()=>new C),this.satAxes=new Array(3).fill().map(()=>new C),this.satBounds=new Array(3).fill().map(()=>new et),this.alignedSatBounds=new Array(3).fill().map(()=>new et),this.needsUpdate=!1,t&&this.min.copy(t),e&&this.max.copy(e),s&&this.matrix.copy(s)}set(t,e,s){this.min.copy(t),this.max.copy(e),this.matrix.copy(s),this.needsUpdate=!0}copy(t){this.min.copy(t.min),this.max.copy(t.max),this.matrix.copy(t.matrix),this.needsUpdate=!0}}O.prototype.update=(function(){return function(){const t=this.matrix,e=this.min,s=this.max,r=this.points;for(let d=0;d<=1;d++)for(let f=0;f<=1;f++)for(let u=0;u<=1;u++){const o=1*d|2*f|4*u,m=r[o];m.x=d?s.x:e.x,m.y=f?s.y:e.y,m.z=u?s.z:e.z,m.applyMatrix4(t)}const a=this.satBounds,i=this.satAxes,l=r[0];for(let d=0;d<3;d++){const f=i[d],u=a[d],o=1<<d,m=r[o];f.subVectors(l,m),u.setFromPoints(f,r)}const c=this.alignedSatBounds;c[0].setFromPointsField(r,"x"),c[1].setFromPointsField(r,"y"),c[2].setFromPointsField(r,"z"),this.invMatrix.copy(this.matrix).invert(),this.needsUpdate=!1}})();O.prototype.intersectsBox=(function(){const n=new et;return function(e){this.needsUpdate&&this.update();const s=e.min,r=e.max,a=this.satBounds,i=this.satAxes,l=this.alignedSatBounds;if(n.min=s.x,n.max=r.x,l[0].isSeparated(n)||(n.min=s.y,n.max=r.y,l[1].isSeparated(n))||(n.min=s.z,n.max=r.z,l[2].isSeparated(n)))return!1;for(let c=0;c<3;c++){const d=i[c],f=a[c];if(n.setFromBox(d,e),f.isSeparated(n))return!1}return!0}})();O.prototype.intersectsTriangle=(function(){const n=new Z,t=new Array(3),e=new et,s=new et,r=new C;return function(i){this.needsUpdate&&this.update(),i.isExtendedTriangle?i.needsUpdate&&i.update():(n.copy(i),n.update(),i=n);const l=this.satBounds,c=this.satAxes;t[0]=i.a,t[1]=i.b,t[2]=i.c;for(let o=0;o<3;o++){const m=l[o],g=c[o];if(e.setFromPoints(g,t),m.isSeparated(e))return!1}const d=i.satBounds,f=i.satAxes,u=this.points;for(let o=0;o<3;o++){const m=d[o],g=f[o];if(e.setFromPoints(g,u),m.isSeparated(e))return!1}for(let o=0;o<3;o++){const m=c[o];for(let g=0;g<4;g++){const T=f[g];if(r.crossVectors(m,T),e.setFromPoints(r,t),s.setFromPoints(r,u),e.isSeparated(s))return!1}}return!0}})();O.prototype.closestPointToPoint=(function(){return function(t,e){return this.needsUpdate&&this.update(),e.copy(t).applyMatrix4(this.invMatrix).clamp(this.min,this.max).applyMatrix4(this.matrix),e}})();O.prototype.distanceToPoint=(function(){const n=new C;return function(e){return this.closestPointToPoint(e,n),e.distanceTo(n)}})();O.prototype.distanceToBox=(function(){const n=["x","y","z"],t=new Array(12).fill().map(()=>new tt),e=new Array(12).fill().map(()=>new tt),s=new C,r=new C;return function(i,l=0,c=null,d=null){if(this.needsUpdate&&this.update(),this.intersectsBox(i))return(c||d)&&(i.getCenter(r),this.closestPointToPoint(r,s),i.closestPointToPoint(s,r),c&&c.copy(s),d&&d.copy(r)),0;const f=l*l,u=i.min,o=i.max,m=this.points;let g=1/0;for(let p=0;p<8;p++){const v=m[p];r.copy(v).clamp(u,o);const h=v.distanceToSquared(r);if(h<g&&(g=h,c&&c.copy(v),d&&d.copy(r),h<f))return Math.sqrt(h)}let T=0;for(let p=0;p<3;p++)for(let v=0;v<=1;v++)for(let h=0;h<=1;h++){const x=(p+1)%3,y=(p+2)%3,b=v<<x|h<<y,w=1<<p|v<<x|h<<y,A=m[b],I=m[w];t[T].set(A,I);const M=n[p],B=n[x],S=n[y],P=e[T],D=P.start,E=P.end;D[M]=u[M],D[B]=v?u[B]:o[B],D[S]=h?u[S]:o[B],E[M]=o[M],E[B]=v?u[B]:o[B],E[S]=h?u[S]:o[B],T++}for(let p=0;p<=1;p++)for(let v=0;v<=1;v++)for(let h=0;h<=1;h++){r.x=p?o.x:u.x,r.y=v?o.y:u.y,r.z=h?o.z:u.z,this.closestPointToPoint(r,s);const x=r.distanceToSquared(s);if(x<g&&(g=x,c&&c.copy(s),d&&d.copy(r),x<f))return Math.sqrt(x)}for(let p=0;p<12;p++){const v=t[p];for(let h=0;h<12;h++){const x=e[h];qe(v,x,s,r);const y=s.distanceToSquared(r);if(y<g&&(g=y,c&&c.copy(s),d&&d.copy(r),y<f))return Math.sqrt(y)}}return Math.sqrt(g)}})();class Di extends We{constructor(){super(()=>new Z)}}const G=new Di,Bt=new C,ye=new C;function Ci(n,t,e={},s=0,r=1/0){const a=s*s,i=r*r;let l=1/0,c=null;if(n.shapecast({boundsTraverseOrder:f=>(Bt.copy(t).clamp(f.min,f.max),Bt.distanceToSquared(t)),intersectsBounds:(f,u,o)=>o<l&&o<i,intersectsTriangle:(f,u)=>{f.closestPointToPoint(t,Bt);const o=t.distanceToSquared(Bt);return o<l&&(ye.copy(Bt),l=o,c=u),o<a}}),l===1/0)return null;const d=Math.sqrt(l);return e.point?e.point.copy(ye):e.point=ye.clone(),e.distance=d,e.faceIndex=c,e}const Ot=parseInt(En)>=169,Ei=parseInt(En)<=161,ct=new C,lt=new C,ut=new C,Wt=new ot,qt=new ot,$t=new ot,cn=new C,ln=new C,un=new C,Pt=new C;function Fi(n,t,e,s,r,a,i,l){let c;if(a===Dn?c=n.intersectTriangle(s,e,t,!0,r):c=n.intersectTriangle(t,e,s,a!==Cn,r),c===null)return null;const d=n.origin.distanceTo(r);return d<i||d>l?null:{distance:d,point:r.clone()}}function fn(n,t,e,s,r,a,i,l,c,d,f){ct.fromBufferAttribute(t,a),lt.fromBufferAttribute(t,i),ut.fromBufferAttribute(t,l);const u=Fi(n,ct,lt,ut,Pt,c,d,f);if(u){if(s){Wt.fromBufferAttribute(s,a),qt.fromBufferAttribute(s,i),$t.fromBufferAttribute(s,l),u.uv=new ot;const m=At.getInterpolation(Pt,ct,lt,ut,Wt,qt,$t,u.uv);Ot||(u.uv=m)}if(r){Wt.fromBufferAttribute(r,a),qt.fromBufferAttribute(r,i),$t.fromBufferAttribute(r,l),u.uv1=new ot;const m=At.getInterpolation(Pt,ct,lt,ut,Wt,qt,$t,u.uv1);Ot||(u.uv1=m),Ei&&(u.uv2=u.uv1)}if(e){cn.fromBufferAttribute(e,a),ln.fromBufferAttribute(e,i),un.fromBufferAttribute(e,l),u.normal=new C;const m=At.getInterpolation(Pt,ct,lt,ut,cn,ln,un,u.normal);u.normal.dot(n.direction)>0&&u.normal.multiplyScalar(-1),Ot||(u.normal=m)}const o={a,b:i,c:l,normal:new C,materialIndex:0};if(At.getNormal(ct,lt,ut,o.normal),u.face=o,u.faceIndex=a,Ot){const m=new C;At.getBarycoord(Pt,ct,lt,ut,m),u.barycoord=m}}return u}function dn(n){return n&&n.isMaterial?n.side:n}function ce(n,t,e,s,r,a,i){const l=s*3;let c=l+0,d=l+1,f=l+2;const{index:u,groups:o}=n;n.index&&(c=u.getX(c),d=u.getX(d),f=u.getX(f));const{position:m,normal:g,uv:T,uv1:p}=n.attributes;if(Array.isArray(t)){const v=s*3;for(let h=0,x=o.length;h<x;h++){const{start:y,count:b,materialIndex:w}=o[h];if(v>=y&&v<y+b){const A=dn(t[w]),I=fn(e,m,g,T,p,c,d,f,A,a,i);if(I)if(I.faceIndex=s,I.face.materialIndex=w,r)r.push(I);else return I}}}else{const v=dn(t),h=fn(e,m,g,T,p,c,d,f,v,a,i);if(h)if(h.faceIndex=s,h.face.materialIndex=0,r)r.push(h);else return h}return null}function N(n,t,e,s){const r=n.a,a=n.b,i=n.c;let l=t,c=t+1,d=t+2;e&&(l=e.getX(l),c=e.getX(c),d=e.getX(d)),r.x=s.getX(l),r.y=s.getY(l),r.z=s.getZ(l),a.x=s.getX(c),a.y=s.getY(c),a.z=s.getZ(c),i.x=s.getX(d),i.y=s.getY(d),i.z=s.getZ(d)}function zi(n,t,e,s,r,a,i,l){const{geometry:c,_indirectBuffer:d}=n;for(let f=s,u=s+r;f<u;f++)ce(c,t,e,f,a,i,l)}function Ri(n,t,e,s,r,a,i){const{geometry:l,_indirectBuffer:c}=n;let d=1/0,f=null;for(let u=s,o=s+r;u<o;u++){let m;m=ce(l,t,e,u,null,a,i),m&&m.distance<d&&(f=m,d=m.distance)}return f}function Ni(n,t,e,s,r,a,i){const{geometry:l}=e,{index:c}=l,d=l.attributes.position;for(let f=n,u=t+n;f<u;f++){let o;if(o=f,N(i,o*3,c,d),i.needsUpdate=!0,s(i,o,r,a))return!0}return!1}function Ui(n,t=null){t&&Array.isArray(t)&&(t=new Set(t));const e=n.geometry,s=e.index?e.index.array:null,r=e.attributes.position;let a,i,l,c,d=0;const f=n._roots;for(let o=0,m=f.length;o<m;o++)a=f[o],i=new Uint32Array(a),l=new Uint16Array(a),c=new Float32Array(a),u(0,d),d+=a.byteLength;function u(o,m,g=!1){const T=o*2;if(U(T,l)){const p=i[o+6],v=l[T+14];let h=1/0,x=1/0,y=1/0,b=-1/0,w=-1/0,A=-1/0;for(let I=3*p,_=3*(p+v);I<_;I++){let M=s[I];const B=r.getX(M),S=r.getY(M),P=r.getZ(M);B<h&&(h=B),B>b&&(b=B),S<x&&(x=S),S>w&&(w=S),P<y&&(y=P),P>A&&(A=P)}return c[o+0]!==h||c[o+1]!==x||c[o+2]!==y||c[o+3]!==b||c[o+4]!==w||c[o+5]!==A?(c[o+0]=h,c[o+1]=x,c[o+2]=y,c[o+3]=b,c[o+4]=w,c[o+5]=A,!0):!1}else{const p=V(o),v=H(o,i);let h=g,x=!1,y=!1;if(t){if(!h){const M=p/k+m/L,B=v/k+m/L;x=t.has(M),y=t.has(B),h=!x&&!y}}else x=!0,y=!0;const b=h||x,w=h||y;let A=!1;b&&(A=u(p,m,h));let I=!1;w&&(I=u(v,m,h));const _=A||I;if(_)for(let M=0;M<3;M++){const B=p+M,S=v+M,P=c[B],D=c[B+3],E=c[S],R=c[S+3];c[o+M]=P<E?P:E,c[o+M+3]=D>R?D:R}return _}}}function at(n,t,e,s,r){let a,i,l,c,d,f;const u=1/e.direction.x,o=1/e.direction.y,m=1/e.direction.z,g=e.origin.x,T=e.origin.y,p=e.origin.z;let v=t[n],h=t[n+3],x=t[n+1],y=t[n+3+1],b=t[n+2],w=t[n+3+2];return u>=0?(a=(v-g)*u,i=(h-g)*u):(a=(h-g)*u,i=(v-g)*u),o>=0?(l=(x-T)*o,c=(y-T)*o):(l=(y-T)*o,c=(x-T)*o),a>c||l>i||((l>a||isNaN(a))&&(a=l),(c<i||isNaN(i))&&(i=c),m>=0?(d=(b-p)*m,f=(w-p)*m):(d=(w-p)*m,f=(b-p)*m),a>f||d>i)?!1:((d>a||a!==a)&&(a=d),(f<i||i!==i)&&(i=f),a<=r&&i>=s)}function ki(n,t,e,s,r,a,i,l){const{geometry:c,_indirectBuffer:d}=n;for(let f=s,u=s+r;f<u;f++){let o=d?d[f]:f;ce(c,t,e,o,a,i,l)}}function Li(n,t,e,s,r,a,i){const{geometry:l,_indirectBuffer:c}=n;let d=1/0,f=null;for(let u=s,o=s+r;u<o;u++){let m;m=ce(l,t,e,c?c[u]:u,null,a,i),m&&m.distance<d&&(f=m,d=m.distance)}return f}function Vi(n,t,e,s,r,a,i){const{geometry:l}=e,{index:c}=l,d=l.attributes.position;for(let f=n,u=t+n;f<u;f++){let o;if(o=e.resolveTriangleIndex(f),N(i,o*3,c,d),i.needsUpdate=!0,s(i,o,r,a))return!0}return!1}function Hi(n,t,e,s,r,a,i){F.setBuffer(n._roots[t]),Ee(0,n,e,s,r,a,i),F.clearBuffer()}function Ee(n,t,e,s,r,a,i){const{float32Array:l,uint16Array:c,uint32Array:d}=F,f=n*2;if(U(f,c)){const o=W(n,d),m=q(f,c);zi(t,e,s,o,m,r,a,i)}else{const o=V(n);at(o,l,s,a,i)&&Ee(o,t,e,s,r,a,i);const m=H(n,d);at(m,l,s,a,i)&&Ee(m,t,e,s,r,a,i)}}const Oi=["x","y","z"];function Wi(n,t,e,s,r,a){F.setBuffer(n._roots[t]);const i=Fe(0,n,e,s,r,a);return F.clearBuffer(),i}function Fe(n,t,e,s,r,a){const{float32Array:i,uint16Array:l,uint32Array:c}=F;let d=n*2;if(U(d,l)){const u=W(n,c),o=q(d,l);return Ri(t,e,s,u,o,r,a)}else{const u=re(n,c),o=Oi[u],g=s.direction[o]>=0;let T,p;g?(T=V(n),p=H(n,c)):(T=H(n,c),p=V(n));const h=at(T,i,s,r,a)?Fe(T,t,e,s,r,a):null;if(h){const b=h.point[o];if(g?b<=i[p+u]:b>=i[p+u+3])return h}const y=at(p,i,s,r,a)?Fe(p,t,e,s,r,a):null;return h&&y?h.distance<=y.distance?h:y:h||y||null}}const Xt=new K,yt=new Z,gt=new Z,Dt=new j,pn=new O,Gt=new O;function qi(n,t,e,s){F.setBuffer(n._roots[t]);const r=ze(0,n,e,s);return F.clearBuffer(),r}function ze(n,t,e,s,r=null){const{float32Array:a,uint16Array:i,uint32Array:l}=F;let c=n*2;if(r===null&&(e.boundingBox||e.computeBoundingBox(),pn.set(e.boundingBox.min,e.boundingBox.max,s),r=pn),U(c,i)){const f=t.geometry,u=f.index,o=f.attributes.position,m=e.index,g=e.attributes.position,T=W(n,l),p=q(c,i);if(Dt.copy(s).invert(),e.boundsTree)return z(n,a,Gt),Gt.matrix.copy(Dt),Gt.needsUpdate=!0,e.boundsTree.shapecast({intersectsBounds:h=>Gt.intersectsBox(h),intersectsTriangle:h=>{h.a.applyMatrix4(s),h.b.applyMatrix4(s),h.c.applyMatrix4(s),h.needsUpdate=!0;for(let x=T*3,y=(p+T)*3;x<y;x+=3)if(N(gt,x,u,o),gt.needsUpdate=!0,h.intersectsTriangle(gt))return!0;return!1}});{const v=ae(e);for(let h=T*3,x=(p+T)*3;h<x;h+=3){N(yt,h,u,o),yt.a.applyMatrix4(Dt),yt.b.applyMatrix4(Dt),yt.c.applyMatrix4(Dt),yt.needsUpdate=!0;for(let y=0,b=v*3;y<b;y+=3)if(N(gt,y,m,g),gt.needsUpdate=!0,yt.intersectsTriangle(gt))return!0}}}else{const f=V(n),u=H(n,l);return z(f,a,Xt),!!(r.intersectsBox(Xt)&&ze(f,t,e,s,r)||(z(u,a,Xt),r.intersectsBox(Xt)&&ze(u,t,e,s,r)))}}const Yt=new j,ge=new O,Ct=new O,$i=new C,Xi=new C,Gi=new C,Yi=new C;function ji(n,t,e,s={},r={},a=0,i=1/0){t.boundingBox||t.computeBoundingBox(),ge.set(t.boundingBox.min,t.boundingBox.max,e),ge.needsUpdate=!0;const l=n.geometry,c=l.attributes.position,d=l.index,f=t.attributes.position,u=t.index,o=G.getPrimitive(),m=G.getPrimitive();let g=$i,T=Xi,p=null,v=null;r&&(p=Gi,v=Yi);let h=1/0,x=null,y=null;return Yt.copy(e).invert(),Ct.matrix.copy(Yt),n.shapecast({boundsTraverseOrder:b=>ge.distanceToBox(b),intersectsBounds:(b,w,A)=>A<h&&A<i?(w&&(Ct.min.copy(b.min),Ct.max.copy(b.max),Ct.needsUpdate=!0),!0):!1,intersectsRange:(b,w)=>{if(t.boundsTree)return t.boundsTree.shapecast({boundsTraverseOrder:I=>Ct.distanceToBox(I),intersectsBounds:(I,_,M)=>M<h&&M<i,intersectsRange:(I,_)=>{for(let M=I,B=I+_;M<B;M++){N(m,3*M,u,f),m.a.applyMatrix4(e),m.b.applyMatrix4(e),m.c.applyMatrix4(e),m.needsUpdate=!0;for(let S=b,P=b+w;S<P;S++){N(o,3*S,d,c),o.needsUpdate=!0;const D=o.distanceToTriangle(m,g,p);if(D<h&&(T.copy(g),v&&v.copy(p),h=D,x=S,y=M),D<a)return!0}}}});{const A=ae(t);for(let I=0,_=A;I<_;I++){N(m,3*I,u,f),m.a.applyMatrix4(e),m.b.applyMatrix4(e),m.c.applyMatrix4(e),m.needsUpdate=!0;for(let M=b,B=b+w;M<B;M++){N(o,3*M,d,c),o.needsUpdate=!0;const S=o.distanceToTriangle(m,g,p);if(S<h&&(T.copy(g),v&&v.copy(p),h=S,x=M,y=I),S<a)return!0}}}}}),G.releasePrimitive(o),G.releasePrimitive(m),h===1/0?null:(s.point?s.point.copy(T):s.point=T.clone(),s.distance=h,s.faceIndex=x,r&&(r.point?r.point.copy(v):r.point=v.clone(),r.point.applyMatrix4(Yt),T.applyMatrix4(Yt),r.distance=T.sub(r.point).length(),r.faceIndex=y),s)}function Zi(n,t=null){t&&Array.isArray(t)&&(t=new Set(t));const e=n.geometry,s=e.index?e.index.array:null,r=e.attributes.position;let a,i,l,c,d=0;const f=n._roots;for(let o=0,m=f.length;o<m;o++)a=f[o],i=new Uint32Array(a),l=new Uint16Array(a),c=new Float32Array(a),u(0,d),d+=a.byteLength;function u(o,m,g=!1){const T=o*2;if(U(T,l)){const p=i[o+6],v=l[T+14];let h=1/0,x=1/0,y=1/0,b=-1/0,w=-1/0,A=-1/0;for(let I=p,_=p+v;I<_;I++){const M=3*n.resolveTriangleIndex(I);for(let B=0;B<3;B++){let S=M+B;S=s?s[S]:S;const P=r.getX(S),D=r.getY(S),E=r.getZ(S);P<h&&(h=P),P>b&&(b=P),D<x&&(x=D),D>w&&(w=D),E<y&&(y=E),E>A&&(A=E)}}return c[o+0]!==h||c[o+1]!==x||c[o+2]!==y||c[o+3]!==b||c[o+4]!==w||c[o+5]!==A?(c[o+0]=h,c[o+1]=x,c[o+2]=y,c[o+3]=b,c[o+4]=w,c[o+5]=A,!0):!1}else{const p=V(o),v=H(o,i);let h=g,x=!1,y=!1;if(t){if(!h){const M=p/k+m/L,B=v/k+m/L;x=t.has(M),y=t.has(B),h=!x&&!y}}else x=!0,y=!0;const b=h||x,w=h||y;let A=!1;b&&(A=u(p,m,h));let I=!1;w&&(I=u(v,m,h));const _=A||I;if(_)for(let M=0;M<3;M++){const B=p+M,S=v+M,P=c[B],D=c[B+3],E=c[S],R=c[S+3];c[o+M]=P<E?P:E,c[o+M+3]=D>R?D:R}return _}}}function Ki(n,t,e,s,r,a,i){F.setBuffer(n._roots[t]),Re(0,n,e,s,r,a,i),F.clearBuffer()}function Re(n,t,e,s,r,a,i){const{float32Array:l,uint16Array:c,uint32Array:d}=F,f=n*2;if(U(f,c)){const o=W(n,d),m=q(f,c);ki(t,e,s,o,m,r,a,i)}else{const o=V(n);at(o,l,s,a,i)&&Re(o,t,e,s,r,a,i);const m=H(n,d);at(m,l,s,a,i)&&Re(m,t,e,s,r,a,i)}}const Qi=["x","y","z"];function Ji(n,t,e,s,r,a){F.setBuffer(n._roots[t]);const i=Ne(0,n,e,s,r,a);return F.clearBuffer(),i}function Ne(n,t,e,s,r,a){const{float32Array:i,uint16Array:l,uint32Array:c}=F;let d=n*2;if(U(d,l)){const u=W(n,c),o=q(d,l);return Li(t,e,s,u,o,r,a)}else{const u=re(n,c),o=Qi[u],g=s.direction[o]>=0;let T,p;g?(T=V(n),p=H(n,c)):(T=H(n,c),p=V(n));const h=at(T,i,s,r,a)?Ne(T,t,e,s,r,a):null;if(h){const b=h.point[o];if(g?b<=i[p+u]:b>=i[p+u+3])return h}const y=at(p,i,s,r,a)?Ne(p,t,e,s,r,a):null;return h&&y?h.distance<=y.distance?h:y:h||y||null}}const jt=new K,bt=new Z,vt=new Z,Et=new j,mn=new O,Zt=new O;function ts(n,t,e,s){F.setBuffer(n._roots[t]);const r=Ue(0,n,e,s);return F.clearBuffer(),r}function Ue(n,t,e,s,r=null){const{float32Array:a,uint16Array:i,uint32Array:l}=F;let c=n*2;if(r===null&&(e.boundingBox||e.computeBoundingBox(),mn.set(e.boundingBox.min,e.boundingBox.max,s),r=mn),U(c,i)){const f=t.geometry,u=f.index,o=f.attributes.position,m=e.index,g=e.attributes.position,T=W(n,l),p=q(c,i);if(Et.copy(s).invert(),e.boundsTree)return z(n,a,Zt),Zt.matrix.copy(Et),Zt.needsUpdate=!0,e.boundsTree.shapecast({intersectsBounds:h=>Zt.intersectsBox(h),intersectsTriangle:h=>{h.a.applyMatrix4(s),h.b.applyMatrix4(s),h.c.applyMatrix4(s),h.needsUpdate=!0;for(let x=T,y=p+T;x<y;x++)if(N(vt,3*t.resolveTriangleIndex(x),u,o),vt.needsUpdate=!0,h.intersectsTriangle(vt))return!0;return!1}});{const v=ae(e);for(let h=T,x=p+T;h<x;h++){const y=t.resolveTriangleIndex(h);N(bt,3*y,u,o),bt.a.applyMatrix4(Et),bt.b.applyMatrix4(Et),bt.c.applyMatrix4(Et),bt.needsUpdate=!0;for(let b=0,w=v*3;b<w;b+=3)if(N(vt,b,m,g),vt.needsUpdate=!0,bt.intersectsTriangle(vt))return!0}}}else{const f=V(n),u=H(n,l);return z(f,a,jt),!!(r.intersectsBox(jt)&&Ue(f,t,e,s,r)||(z(u,a,jt),r.intersectsBox(jt)&&Ue(u,t,e,s,r)))}}const Kt=new j,be=new O,Ft=new O,es=new C,ns=new C,is=new C,ss=new C;function rs(n,t,e,s={},r={},a=0,i=1/0){t.boundingBox||t.computeBoundingBox(),be.set(t.boundingBox.min,t.boundingBox.max,e),be.needsUpdate=!0;const l=n.geometry,c=l.attributes.position,d=l.index,f=t.attributes.position,u=t.index,o=G.getPrimitive(),m=G.getPrimitive();let g=es,T=ns,p=null,v=null;r&&(p=is,v=ss);let h=1/0,x=null,y=null;return Kt.copy(e).invert(),Ft.matrix.copy(Kt),n.shapecast({boundsTraverseOrder:b=>be.distanceToBox(b),intersectsBounds:(b,w,A)=>A<h&&A<i?(w&&(Ft.min.copy(b.min),Ft.max.copy(b.max),Ft.needsUpdate=!0),!0):!1,intersectsRange:(b,w)=>{if(t.boundsTree){const A=t.boundsTree;return A.shapecast({boundsTraverseOrder:I=>Ft.distanceToBox(I),intersectsBounds:(I,_,M)=>M<h&&M<i,intersectsRange:(I,_)=>{for(let M=I,B=I+_;M<B;M++){const S=A.resolveTriangleIndex(M);N(m,3*S,u,f),m.a.applyMatrix4(e),m.b.applyMatrix4(e),m.c.applyMatrix4(e),m.needsUpdate=!0;for(let P=b,D=b+w;P<D;P++){const E=n.resolveTriangleIndex(P);N(o,3*E,d,c),o.needsUpdate=!0;const R=o.distanceToTriangle(m,g,p);if(R<h&&(T.copy(g),v&&v.copy(p),h=R,x=P,y=M),R<a)return!0}}}})}else{const A=ae(t);for(let I=0,_=A;I<_;I++){N(m,3*I,u,f),m.a.applyMatrix4(e),m.b.applyMatrix4(e),m.c.applyMatrix4(e),m.needsUpdate=!0;for(let M=b,B=b+w;M<B;M++){const S=n.resolveTriangleIndex(M);N(o,3*S,d,c),o.needsUpdate=!0;const P=o.distanceToTriangle(m,g,p);if(P<h&&(T.copy(g),v&&v.copy(p),h=P,x=M,y=I),P<a)return!0}}}}}),G.releasePrimitive(o),G.releasePrimitive(m),h===1/0?null:(s.point?s.point.copy(T):s.point=T.clone(),s.distance=h,s.faceIndex=x,r&&(r.point?r.point.copy(v):r.point=v.clone(),r.point.applyMatrix4(Kt),T.applyMatrix4(Kt),r.distance=T.sub(r.point).length(),r.faceIndex=y),s)}const Nt=new F.constructor,se=new F.constructor,it=new We(()=>new K),Tt=new K,wt=new K,ve=new K,Te=new K;let we=!1;function os(n,t,e,s){if(we)throw new Error("MeshBVH: Recursive calls to bvhcast not supported.");we=!0;const r=n._roots,a=t._roots;let i,l=0,c=0;const d=new j().copy(e).invert();for(let f=0,u=r.length;f<u;f++){Nt.setBuffer(r[f]),c=0;const o=it.getPrimitive();z(0,Nt.float32Array,o),o.applyMatrix4(d);for(let m=0,g=a.length;m<g&&(se.setBuffer(a[m]),i=Y(0,0,e,d,s,l,c,0,0,o),se.clearBuffer(),c+=a[m].byteLength/L,!i);m++);if(it.releasePrimitive(o),Nt.clearBuffer(),l+=r[f].byteLength/L,i)break}return we=!1,i}function Y(n,t,e,s,r,a=0,i=0,l=0,c=0,d=null,f=!1){let u,o;f?(u=se,o=Nt):(u=Nt,o=se);const m=u.float32Array,g=u.uint32Array,T=u.uint16Array,p=o.float32Array,v=o.uint32Array,h=o.uint16Array,x=n*2,y=t*2,b=U(x,T),w=U(y,h);let A=!1;if(w&&b)f?A=r(W(t,v),q(t*2,h),W(n,g),q(n*2,T),c,i+t/k,l,a+n/k):A=r(W(n,g),q(n*2,T),W(t,v),q(t*2,h),l,a+n/k,c,i+t/k);else if(w){const I=it.getPrimitive();z(t,p,I),I.applyMatrix4(e);const _=V(n),M=H(n,g);z(_,m,Tt),z(M,m,wt);const B=I.intersectsBox(Tt),S=I.intersectsBox(wt);A=B&&Y(t,_,s,e,r,i,a,c,l+1,I,!f)||S&&Y(t,M,s,e,r,i,a,c,l+1,I,!f),it.releasePrimitive(I)}else{const I=V(t),_=H(t,v);z(I,p,ve),z(_,p,Te);const M=d.intersectsBox(ve),B=d.intersectsBox(Te);if(M&&B)A=Y(n,I,e,s,r,a,i,l,c+1,d,f)||Y(n,_,e,s,r,a,i,l,c+1,d,f);else if(M)if(b)A=Y(n,I,e,s,r,a,i,l,c+1,d,f);else{const S=it.getPrimitive();S.copy(ve).applyMatrix4(e);const P=V(n),D=H(n,g);z(P,m,Tt),z(D,m,wt);const E=S.intersectsBox(Tt),R=S.intersectsBox(wt);A=E&&Y(I,P,s,e,r,i,a,c,l+1,S,!f)||R&&Y(I,D,s,e,r,i,a,c,l+1,S,!f),it.releasePrimitive(S)}else if(B)if(b)A=Y(n,_,e,s,r,a,i,l,c+1,d,f);else{const S=it.getPrimitive();S.copy(Te).applyMatrix4(e);const P=V(n),D=H(n,g);z(P,m,Tt),z(D,m,wt);const E=S.intersectsBox(Tt),R=S.intersectsBox(wt);A=E&&Y(_,P,s,e,r,i,a,c,l+1,S,!f)||R&&Y(_,D,s,e,r,i,a,c,l+1,S,!f),it.releasePrimitive(S)}}return A}function hn(n,t,e){return n===null?null:(n.point.applyMatrix4(t.matrixWorld),n.distance=n.point.distanceTo(e.ray.origin),n.object=t,n)}function as(){return typeof SharedArrayBuffer<"u"}function Ls(n,t){if(n===null)return n;if(n.buffer){const e=n.buffer;if(e.constructor===t)return n;const s=n.constructor,r=new s(new t(e.byteLength));return r.set(n),r}else{if(n.constructor===t)return n;const e=new t(n.byteLength);return new Uint8Array(e).set(new Uint8Array(n)),e}}function cs(n,t){const e=n[n.length-1],s=e.offset+e.count>2**16,r=n.reduce((d,f)=>d+f.count,0),a=s?4:2,i=t?new SharedArrayBuffer(r*a):new ArrayBuffer(r*a),l=s?new Uint32Array(i):new Uint16Array(i);let c=0;for(let d=0;d<n.length;d++){const{offset:f,count:u}=n[d];for(let o=0;o<u;o++)l[c+o]=f+o;c+=u}return l}class ls extends Ii{get indirect(){return!!this._indirectBuffer}get primitiveStride(){return null}get primitiveBufferStride(){return this.indirect?1:this.primitiveStride}set primitiveBufferStride(t){}get primitiveBuffer(){return this.indirect?this._indirectBuffer:this.geometry.index.array}set primitiveBuffer(t){}constructor(t,e={}){if(t.isBufferGeometry){if(t.index&&t.index.isInterleavedBufferAttribute)throw new Error("BVH: InterleavedBufferAttribute is not supported for the index attribute.")}else throw new Error("BVH: Only BufferGeometries are supported.");if(e.useSharedArrayBuffer&&!as())throw new Error("BVH: SharedArrayBuffer is not available.");super(),this.geometry=t,this.resolvePrimitiveIndex=e.indirect?s=>this._indirectBuffer[s]:s=>s,this.primitiveBuffer=null,this.primitiveBufferStride=null,this._indirectBuffer=null,e={...Nn,...e},e[Oe]||this.init(e)}init(t){const{geometry:e,primitiveStride:s}=this;if(t.indirect){const r=Ce(e,t.range,s),a=cs(r,t.useSharedArrayBuffer);this._indirectBuffer=a}else Ai(e,t);super.init(t),!e.boundingBox&&t.setBoundingBox&&(e.boundingBox=this.getBoundingBox(new K))}computePrimitiveBounds(){throw new Error("BVH: computePrimitiveBounds() not implemented")}getRootRanges(t){return this.indirect?[{offset:0,count:this._indirectBuffer.length}]:Ce(this.geometry,t,this.primitiveStride)}raycastObject3D(){throw new Error("BVH: raycastObject3D() not implemented")}shapecast(t){let{iterateDirect:e,iterateIndirect:s,...r}=t;const a=this.indirect?s:e;return super.shapecast({...r,iterate:a})}}const Qt=new O,Jt=new Jn,xn=new C,yn=new j,gn=new C;class $e extends ls{static serialize(t,e={}){e={cloneBuffers:!0,...e};const s=t.geometry,r=t._roots,a=t._indirectBuffer,i=s.getIndex(),l={version:1,roots:null,index:null,indirectBuffer:null};return e.cloneBuffers?(l.roots=r.map(c=>c.slice()),l.index=i?i.array.slice():null,l.indirectBuffer=a?a.slice():null):(l.roots=r,l.index=i?i.array:null,l.indirectBuffer=a),l}static deserialize(t,e,s={}){s={setIndex:!0,indirect:!!t.indirectBuffer,...s};const{index:r,roots:a,indirectBuffer:i}=t;t.version||(console.warn("MeshBVH.deserialize: Serialization format has been changed and will be fixed up. It is recommended to regenerate any stored serialized data."),c(a));const l=new $e(e,{...s,[Oe]:!0});if(l._roots=a,l._indirectBuffer=i||null,s.setIndex){const d=e.getIndex();if(d===null){const f=new X(t.index,1,!1);e.setIndex(f)}else d.array!==r&&(d.array.set(r),d.needsUpdate=!0)}return l;function c(d){for(let f=0;f<d.length;f++){const u=d[f],o=new Uint32Array(u),m=new Uint16Array(u);for(let g=0,T=u.byteLength/L;g<T;g++){const p=k*g,v=2*p;U(v,m)||(o[p+6]=o[p+6]/k-g)}}}}get primitiveStride(){return 3}get resolveTriangleIndex(){return this.resolvePrimitiveIndex}constructor(t,e={}){e.maxLeafTris&&(e={...e,maxLeafSize:e.maxLeafTris}),super(t,e)}shiftTriangleOffsets(t){return super.shiftPrimitiveOffsets(t)}computePrimitiveBounds(t,e,s){const r=this.geometry,a=this._indirectBuffer,i=r.attributes.position,l=r.index?r.index.array:null,c=i.normalized;if(t<0||e+t-s.offset>s.length/6)throw new Error("MeshBVH: compute triangle bounds range is invalid.");const d=i.array,f=i.offset||0;let u=3;i.isInterleavedBufferAttribute&&(u=i.data.stride);const o=["getX","getY","getZ"],m=s.offset;for(let g=t,T=t+e;g<T;g++){const v=(a?a[g]:g)*3,h=(g-m)*6;let x=v+0,y=v+1,b=v+2;l&&(x=l[x],y=l[y],b=l[b]),c||(x=x*u+f,y=y*u+f,b=b*u+f);for(let w=0;w<3;w++){let A,I,_;c?(A=i[o[w]](x),I=i[o[w]](y),_=i[o[w]](b)):(A=d[x+w],I=d[y+w],_=d[b+w]);let M=A;I<M&&(M=I),_<M&&(M=_);let B=A;I>B&&(B=I),_>B&&(B=_);const S=(B-M)/2,P=w*2;s[h+P+0]=M+S,s[h+P+1]=S+(Math.abs(M)+S)*di}}return s}raycastObject3D(t,e,s=[]){const{material:r}=t;if(r===void 0)return;yn.copy(t.matrixWorld).invert(),Jt.copy(e.ray).applyMatrix4(yn),gn.setFromMatrixScale(t.matrixWorld),xn.copy(Jt.direction).multiply(gn);const a=xn.length(),i=e.near/a,l=e.far/a;if(e.firstHitOnly===!0){let c=this.raycastFirst(Jt,r,i,l);c=hn(c,t,e),c&&s.push(c)}else{const c=this.raycast(Jt,r,i,l);for(let d=0,f=c.length;d<f;d++){const u=hn(c[d],t,e);u&&s.push(u)}}return s}refit(t=null){return(this.indirect?Zi:Ui)(this,t)}raycast(t,e=Se,s=0,r=1/0){const a=this._roots,i=[],l=this.indirect?Ki:Hi;for(let c=0,d=a.length;c<d;c++)l(this,c,e,t,i,s,r);return i}raycastFirst(t,e=Se,s=0,r=1/0){const a=this._roots;let i=null;const l=this.indirect?Ji:Wi;for(let c=0,d=a.length;c<d;c++){const f=l(this,c,e,t,s,r);f!=null&&(i==null||f.distance<i.distance)&&(i=f)}return i}intersectsGeometry(t,e){let s=!1;const r=this._roots,a=this.indirect?ts:qi;for(let i=0,l=r.length;i<l&&(s=a(this,i,t,e),!s);i++);return s}shapecast(t){const e=G.getPrimitive(),s=super.shapecast({...t,intersectsPrimitive:t.intersectsTriangle,scratchPrimitive:e,iterateDirect:Ni,iterateIndirect:Vi});return G.releasePrimitive(e),s}bvhcast(t,e,s){let{intersectsRanges:r,intersectsTriangles:a}=s;const i=G.getPrimitive(),l=this.geometry.index,c=this.geometry.attributes.position,d=this.indirect?g=>{const T=this.resolveTriangleIndex(g);N(i,T*3,l,c)}:g=>{N(i,g*3,l,c)},f=G.getPrimitive(),u=t.geometry.index,o=t.geometry.attributes.position,m=t.indirect?g=>{const T=t.resolveTriangleIndex(g);N(f,T*3,u,o)}:g=>{N(f,g*3,u,o)};if(a){const g=(T,p,v,h,x,y,b,w)=>{for(let A=v,I=v+h;A<I;A++){m(A),f.a.applyMatrix4(e),f.b.applyMatrix4(e),f.c.applyMatrix4(e),f.needsUpdate=!0;for(let _=T,M=T+p;_<M;_++)if(d(_),i.needsUpdate=!0,a(i,f,_,A,x,y,b,w))return!0}return!1};if(r){const T=r;r=function(p,v,h,x,y,b,w,A){return T(p,v,h,x,y,b,w,A)?!0:g(p,v,h,x,y,b,w,A)}}else r=g}return os(this,t,e,r)}intersectsBox(t,e){return Qt.set(t.min,t.max,e),Qt.needsUpdate=!0,this.shapecast({intersectsBounds:s=>Qt.intersectsBox(s),intersectsTriangle:s=>Qt.intersectsTriangle(s)})}intersectsSphere(t){return this.shapecast({intersectsBounds:e=>t.intersectsBox(e),intersectsTriangle:e=>e.intersectsSphere(t)})}closestPointToGeometry(t,e,s={},r={},a=0,i=1/0){return(this.indirect?rs:ji)(this,t,e,s,r,a,i)}closestPointToPoint(t,e={},s=0,r=1/0){return Ci(this,t,e,s,r)}}function us(n){switch(n){case 1:return"R";case 2:return"RG";case 3:return"RGBA";case 4:return"RGBA"}throw new Error}function fs(n){switch(n){case 1:return si;case 2:return ii;case 3:return Ut;case 4:return Ut}}function bn(n){switch(n){case 1:return ni;case 2:return Fn;case 3:return Ie;case 4:return Ie}}class Vn extends ie{constructor(){super(),this.minFilter=st,this.magFilter=st,this.generateMipmaps=!1,this.overrideItemSize=null,this._forcedType=null}updateFrom(t){const e=this.overrideItemSize,s=t.itemSize,r=t.count;if(e!==null){if(s*r%e!==0)throw new Error("VertexAttributeTexture: overrideItemSize must divide evenly into buffer length.");t.itemSize=e,t.count=r*s/e}const a=t.itemSize,i=t.count,l=t.normalized,c=t.array.constructor,d=c.BYTES_PER_ELEMENT;let f=this._forcedType,u=a;if(f===null)switch(c){case Float32Array:f=It;break;case Uint8Array:case Uint16Array:case Uint32Array:f=Rt;break;case Int8Array:case Int16Array:case Int32Array:f=pe;break}let o,m,g,T,p=us(a);switch(f){case It:g=1,m=fs(a),l&&d===1?(T=c,p+="8",c===Uint8Array?o=Ke:(o=Qe,p+="_SNORM")):(T=Float32Array,p+="32F",o=It);break;case pe:p+=d*8+"I",g=l?Math.pow(2,c.BYTES_PER_ELEMENT*8-1):1,m=bn(a),d===1?(T=Int8Array,o=Qe):d===2?(T=Int16Array,o=ei):(T=Int32Array,o=pe);break;case Rt:p+=d*8+"UI",g=l?Math.pow(2,c.BYTES_PER_ELEMENT*8-1):1,m=bn(a),d===1?(T=Uint8Array,o=Ke):d===2?(T=Uint16Array,o=ti):(T=Uint32Array,o=Rt);break}u===3&&(m===Ut||m===Ie)&&(u=4);const v=Math.ceil(Math.sqrt(i))||1,h=u*v*v,x=new T(h),y=t.normalized;t.normalized=!1;for(let b=0;b<i;b++){const w=u*b;x[w]=t.getX(b)/g,a>=2&&(x[w+1]=t.getY(b)/g),a>=3&&(x[w+2]=t.getZ(b)/g,u===4&&(x[w+3]=1)),a>=4&&(x[w+3]=t.getW(b)/g)}t.normalized=y,this.internalFormat=p,this.format=m,this.type=o,this.image.width=v,this.image.height=v,this.image.data=x,this.needsUpdate=!0,this.dispose(),t.itemSize=s,t.count=r}}class ds extends Vn{constructor(){super(),this._forcedType=Rt}}class ps extends Vn{constructor(){super(),this._forcedType=It}}class Vs{constructor(){this.index=new ds,this.position=new ps,this.bvhBounds=new ie,this.bvhContents=new ie,this._cachedIndexAttr=null,this.index.overrideItemSize=3}updateFrom(t){const{geometry:e}=t;if(hs(t,this.bvhBounds,this.bvhContents),this.position.updateFrom(e.attributes.position),t.indirect){const s=t._indirectBuffer;if(this._cachedIndexAttr===null||this._cachedIndexAttr.count!==s.length)if(e.index)this._cachedIndexAttr=e.index.clone();else{const r=Ln(oe(e));this._cachedIndexAttr=new X(r,1,!1)}ms(e,s,this._cachedIndexAttr),this.index.updateFrom(this._cachedIndexAttr)}else this.index.updateFrom(e.index)}dispose(){const{index:t,position:e,bvhBounds:s,bvhContents:r}=this;t&&t.dispose(),e&&e.dispose(),s&&s.dispose(),r&&r.dispose()}}function ms(n,t,e){const s=e.array,r=n.index?n.index.array:null;for(let a=0,i=t.length;a<i;a++){const l=3*a,c=3*t[a];for(let d=0;d<3;d++)s[l+d]=r?r[c+d]:c+d}}function hs(n,t,e){const s=n._roots;if(s.length!==1)throw new Error("MeshBVHUniformStruct: Multi-root BVHs not supported.");const r=s[0],a=new Uint16Array(r),i=new Uint32Array(r),l=new Float32Array(r),c=r.byteLength/L,d=2*Math.ceil(Math.sqrt(c/2)),f=new Float32Array(4*d*d),u=Math.ceil(Math.sqrt(c)),o=new Uint32Array(2*u*u);for(let m=0;m<c;m++){const g=m*L/4,T=g*2,p=g;for(let v=0;v<3;v++)f[8*m+0+v]=l[p+0+v],f[8*m+4+v]=l[p+3+v];if(U(T,a)){const v=q(T,a),h=W(g,i),x=fi|v;o[m*2+0]=x,o[m*2+1]=h}else{const v=i[g+6],h=re(g,i);o[m*2+0]=h,o[m*2+1]=v}}t.image.data=f,t.image.width=d,t.image.height=d,t.format=Ut,t.type=It,t.internalFormat="RGBA32F",t.minFilter=st,t.magFilter=st,t.generateMipmaps=!1,t.needsUpdate=!0,t.dispose(),e.image.data=o,e.image.width=u,e.image.height=u,e.format=Fn,e.type=Rt,e.internalFormat="RG32UI",e.minFilter=st,e.magFilter=st,e.generateMipmaps=!1,e.needsUpdate=!0,e.dispose()}const Hs=`

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
`,Os=`

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
#define	bvhIntersectFirstHit(		bvh,		rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist	)	_bvhIntersectFirstHit(		bvh.position, bvh.index, bvh.bvhBounds, bvh.bvhContents,		rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist	)

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
			uint rightIndex = currNodeIndex + boundsInfo.y;

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
`,Ws=`
struct BVH {

	usampler2D index;
	sampler2D position;

	sampler2D bvhBounds;
	usampler2D bvhContents;

};
`;function Hn(n,t,e=0){if(n.isInterleavedBufferAttribute){const s=n.itemSize;for(let r=0,a=n.count;r<a;r++){const i=r+e;t.setX(i,n.getX(r)),s>=2&&t.setY(i,n.getY(r)),s>=3&&t.setZ(i,n.getZ(r)),s>=4&&t.setW(i,n.getW(r))}}else{const s=t.array,r=s.constructor,a=s.BYTES_PER_ELEMENT*n.itemSize*e;new r(s.buffer,a,n.array.length).set(n.array)}}function zt(n,t=null){const e=n.array.constructor,s=n.normalized,r=n.itemSize,a=t===null?n.count:t;return new X(new e(r*a),r,s)}function Mt(n,t){if(!n&&!t)return!0;if(!!n!=!!t)return!1;const e=n.count===t.count,s=n.normalized===t.normalized,r=n.array.constructor===t.array.constructor,a=n.itemSize===t.itemSize;return!(!e||!s||!r||!a)}function xs(n){const t=n[0].index!==null,e=new Set(Object.keys(n[0].attributes));if(!n[0].getAttribute("position"))throw new Error("StaticGeometryGenerator: position attribute is required.");for(let s=0;s<n.length;++s){const r=n[s];let a=0;if(t!==(r.index!==null))throw new Error("StaticGeometryGenerator: All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them.");for(const i in r.attributes){if(!e.has(i))throw new Error('StaticGeometryGenerator: All geometries must have compatible attributes; make sure "'+i+'" attribute exists among all geometries, or in none of them.');a++}if(a!==e.size)throw new Error("StaticGeometryGenerator: All geometries must have the same number of attributes.")}}function ys(n){let t=0;for(let e=0,s=n.length;e<s;e++)t+=n[e].getIndex().count;return t}function gs(n){let t=0;for(let e=0,s=n.length;e<s;e++)t+=n[e].getAttribute("position").count;return t}function bs(n,t,e){n.index&&n.index.count!==t&&n.setIndex(null);const s=n.attributes;for(const r in s)s[r].count!==e&&n.deleteAttribute(r)}function vs(n,t={},e=new mt){const{useGroups:s=!1,forceUpdate:r=!1,skipAssigningAttributes:a=[],overwriteIndex:i=!0}=t;xs(n);const l=n[0].index!==null,c=l?ys(n):-1,d=gs(n);if(bs(e,c,d),s){let u=0;for(let o=0,m=n.length;o<m;o++){const g=n[o];let T;l?T=g.getIndex().count:T=g.getAttribute("position").count,e.addGroup(u,T,o),u+=T}}if(l){let u=!1;if(e.index||(e.setIndex(new X(new Uint32Array(c),1,!1)),u=!0),u||i){let o=0,m=0;const g=e.getIndex();for(let T=0,p=n.length;T<p;T++){const v=n[T],h=v.getIndex();if(!(!r&&!u&&a[T]))for(let y=0;y<h.count;++y)g.setX(o+y,h.getX(y)+m);o+=h.count,m+=v.getAttribute("position").count}}}const f=Object.keys(n[0].attributes);for(let u=0,o=f.length;u<o;u++){let m=!1;const g=f[u];if(!e.getAttribute(g)){const v=n[0].getAttribute(g);e.setAttribute(g,zt(v,d)),m=!0}let T=0;const p=e.getAttribute(g);for(let v=0,h=n.length;v<h;v++){const x=n[v],y=!r&&!m&&a[v],b=x.getAttribute(g);if(!y)if(g==="color"&&p.itemSize!==b.itemSize)for(let w=T,A=b.count;w<A;w++)b.setXYZW(w,p.getX(w),p.getY(w),p.getZ(w),1);else Hn(b,p,T);T+=b.count}}}function Ts(n,t,e){const s=n.index,a=n.attributes.position.count,i=s?s.count:a;let l=n.groups;l.length===0&&(l=[{count:i,start:0,materialIndex:0}]);let c=n.getAttribute("materialIndex");if(!c||c.count!==a){let f;e.length<=255?f=new Uint8Array(a):f=new Uint16Array(a),c=new X(f,1,!1),n.deleteAttribute("materialIndex"),n.setAttribute("materialIndex",c)}const d=c.array;for(let f=0;f<l.length;f++){const u=l[f],o=u.start,m=u.count,g=Math.min(m,i-o),T=Array.isArray(t)?t[u.materialIndex]:t,p=e.indexOf(T);for(let v=0;v<g;v++){let h=o+v;s&&(h=s.getX(h)),d[h]=p}}}function ws(n,t){if(!n.index){const e=n.attributes.position.count,s=new Array(e);for(let r=0;r<e;r++)s[r]=r;n.setIndex(s)}if(!n.attributes.normal&&t&&t.includes("normal")&&n.computeVertexNormals(),!n.attributes.uv&&t&&t.includes("uv")){const e=n.attributes.position.count;n.setAttribute("uv",new X(new Float32Array(e*2),2,!1))}if(!n.attributes.uv2&&t&&t.includes("uv2")){const e=n.attributes.position.count;n.setAttribute("uv2",new X(new Float32Array(e*2),2,!1))}if(!n.attributes.tangent&&t&&t.includes("tangent"))if(n.attributes.uv&&n.attributes.normal)n.computeTangents();else{const e=n.attributes.position.count;n.setAttribute("tangent",new X(new Float32Array(e*4),4,!1))}if(!n.attributes.color&&t&&t.includes("color")){const e=n.attributes.position.count,s=new Float32Array(e*4);s.fill(1),n.setAttribute("color",new X(s,4))}}function On(n){let t=0;if(n.byteLength!==0){const e=new Uint8Array(n);for(let s=0;s<n.byteLength;s++){const r=e[s];t=(t<<5)-t+r,t|=0}}return t}function vn(n){let t=n.uuid;const e=Object.values(n.attributes);n.index&&(e.push(n.index),t+=`index|${n.index.version}`);const s=Object.keys(e).sort();for(const r of s){const a=e[r];t+=`${r}_${a.version}|`}return t}function Tn(n){const t=n.skeleton;return t?(t.boneTexture||t.computeBoneTexture(),`${On(t.boneTexture.image.data.buffer)}_${t.boneTexture.uuid}`):null}class As{constructor(t=null){this.matrixWorld=new j,this.geometryHash=null,this.skeletonHash=null,this.primitiveCount=-1,t!==null&&this.updateFrom(t)}updateFrom(t){const e=t.geometry,s=(e.index?e.index.count:e.attributes.position.count)/3;this.matrixWorld.copy(t.matrixWorld),this.geometryHash=vn(e),this.primitiveCount=s,this.skeletonHash=Tn(t)}didChange(t){const e=t.geometry,s=(e.index?e.index.count:e.attributes.position.count)/3;return!(this.matrixWorld.equals(t.matrixWorld)&&this.geometryHash===vn(e)&&this.skeletonHash===Tn(t)&&this.primitiveCount===s)}}const ft=new C,dt=new C,pt=new C,wn=new Ve,te=new C,Ae=new C,An=new Ve,Mn=new Ve,ee=new j,Sn=new j;function In(n,t,e){const s=n.skeleton,r=n.geometry,a=s.bones,i=s.boneInverses;An.fromBufferAttribute(r.attributes.skinIndex,t),Mn.fromBufferAttribute(r.attributes.skinWeight,t),ee.elements.fill(0);for(let l=0;l<4;l++){const c=Mn.getComponent(l);if(c!==0){const d=An.getComponent(l);Sn.multiplyMatrices(a[d].matrixWorld,i[d]),Ms(ee,Sn,c)}}return ee.multiply(n.bindMatrix).premultiply(n.bindMatrixInverse),e.transformDirection(ee),e}function Me(n,t,e,s,r){te.set(0,0,0);for(let a=0,i=n.length;a<i;a++){const l=t[a],c=n[a];l!==0&&(Ae.fromBufferAttribute(c,s),e?te.addScaledVector(Ae,l):te.addScaledVector(Ae.sub(r),l))}r.add(te)}function Ms(n,t,e){const s=n.elements,r=t.elements;for(let a=0,i=r.length;a<i;a++)s[a]+=r[a]*e}function Ss(n){const{index:t,attributes:e}=n;if(t)for(let s=0,r=t.count;s<r;s+=3){const a=t.getX(s),i=t.getX(s+2);t.setX(s,i),t.setX(s+2,a)}else for(const s in e){const r=e[s],a=r.itemSize;for(let i=0,l=r.count;i<l;i+=3)for(let c=0;c<a;c++){const d=r.getComponent(i,c),f=r.getComponent(i+2,c);r.setComponent(i,c,f),r.setComponent(i+2,c,d)}}return n}function Is(n,t={},e=new mt){t={applyWorldTransforms:!0,attributes:[],...t};const s=n.geometry,r=t.applyWorldTransforms,a=t.attributes.includes("normal"),i=t.attributes.includes("tangent"),l=s.attributes,c=e.attributes;for(const h in e.attributes)(!t.attributes.includes(h)||!(h in s.attributes))&&e.deleteAttribute(h);!e.index&&s.index&&(e.index=s.index.clone()),c.position||e.setAttribute("position",zt(l.position)),a&&!c.normal&&l.normal&&e.setAttribute("normal",zt(l.normal)),i&&!c.tangent&&l.tangent&&e.setAttribute("tangent",zt(l.tangent)),Mt(s.index,e.index),Mt(l.position,c.position),a&&Mt(l.normal,c.normal),i&&Mt(l.tangent,c.tangent);const d=l.position,f=a?l.normal:null,u=i?l.tangent:null,o=s.morphAttributes.position,m=s.morphAttributes.normal,g=s.morphAttributes.tangent,T=s.morphTargetsRelative,p=n.morphTargetInfluences,v=new ri;v.getNormalMatrix(n.matrixWorld),s.index&&e.index.array.set(s.index.array);for(let h=0,x=l.position.count;h<x;h++)ft.fromBufferAttribute(d,h),f&&dt.fromBufferAttribute(f,h),u&&(wn.fromBufferAttribute(u,h),pt.fromBufferAttribute(u,h)),p&&(o&&Me(o,p,T,h,ft),m&&Me(m,p,T,h,dt),g&&Me(g,p,T,h,pt)),n.isSkinnedMesh&&(n.applyBoneTransform(h,ft),f&&In(n,h,dt),u&&In(n,h,pt)),r&&ft.applyMatrix4(n.matrixWorld),c.position.setXYZ(h,ft.x,ft.y,ft.z),f&&(r&&dt.applyNormalMatrix(v),c.normal.setXYZ(h,dt.x,dt.y,dt.z)),u&&(r&&pt.transformDirection(n.matrixWorld),c.tangent.setXYZW(h,pt.x,pt.y,pt.z,wn.w));for(const h in t.attributes){const x=t.attributes[h];x==="position"||x==="tangent"||x==="normal"||!(x in l)||(c[x]||e.setAttribute(x,zt(l[x])),Mt(l[x],c[x]),Hn(l[x],c[x]))}return n.matrixWorld.determinant()<0&&Ss(e),e}class _s extends mt{constructor(){super(),this.version=0,this.hash=null,this._diff=new As}isCompatible(t,e){const s=t.geometry;for(let r=0;r<e.length;r++){const a=e[r],i=s.attributes[a],l=this.attributes[a];if(i&&!Mt(i,l))return!1}return!0}updateFrom(t,e){const s=this._diff;return s.didChange(t)?(Is(t,e,this),s.updateFrom(t),this.version++,this.hash=`${this.uuid}_${this.version}`,!0):!1}}const ke=0,Wn=1,qn=2;function Bs(n,t){for(let e=0,s=n.length;e<s;e++)n[e].traverseVisible(a=>{a.isMesh&&t(a)})}function Ps(n){const t=[];for(let e=0,s=n.length;e<s;e++){const r=n[e];Array.isArray(r.material)?t.push(...r.material):t.push(r.material)}return t}function Ds(n,t,e){if(n.length===0){t.setIndex(null);const s=t.attributes;for(const r in s)t.deleteAttribute(r);for(const r in e.attributes)t.setAttribute(e.attributes[r],new X(new Float32Array(0),4,!1))}else vs(n,e,t);for(const s in t.attributes)t.attributes[s].needsUpdate=!0}class Cs{constructor(t){this.objects=null,this.useGroups=!0,this.applyWorldTransforms=!0,this.generateMissingAttributes=!0,this.overwriteIndex=!0,this.attributes=["position","normal","color","tangent","uv","uv2"],this._intermediateGeometry=new Map,this._geometryMergeSets=new WeakMap,this._mergeOrder=[],this._dummyMesh=null,this.setObjects(t||[])}_getDummyMesh(){if(!this._dummyMesh){const t=new oi,e=new mt;e.setAttribute("position",new X(new Float32Array(9),3)),this._dummyMesh=new Bn(e,t)}return this._dummyMesh}_getMeshes(){const t=[];return Bs(this.objects,e=>{t.push(e)}),t.sort((e,s)=>e.uuid>s.uuid?1:e.uuid<s.uuid?-1:0),t.length===0&&t.push(this._getDummyMesh()),t}_updateIntermediateGeometries(){const{_intermediateGeometry:t}=this,e=this._getMeshes(),s=new Set(t.keys()),r={attributes:this.attributes,applyWorldTransforms:this.applyWorldTransforms};for(let a=0,i=e.length;a<i;a++){const l=e[a],c=l.uuid;s.delete(c);let d=t.get(c);(!d||!d.isCompatible(l,this.attributes))&&(d&&d.dispose(),d=new _s,t.set(c,d)),d.updateFrom(l,r)&&this.generateMissingAttributes&&ws(d,this.attributes)}s.forEach(a=>{t.delete(a)})}setObjects(t){Array.isArray(t)?this.objects=[...t]:this.objects=[t]}generate(t=new mt){const{useGroups:e,overwriteIndex:s,_intermediateGeometry:r,_geometryMergeSets:a}=this,i=this._getMeshes(),l=[],c=[],d=a.get(t)||[];this._updateIntermediateGeometries();let f=!1;i.length!==d.length&&(f=!0);for(let o=0,m=i.length;o<m;o++){const g=i[o],T=r.get(g.uuid);c.push(T);const p=d[o];!p||p.uuid!==T.uuid?(l.push(!1),f=!0):p.version!==T.version?l.push(!1):l.push(!0)}Ds(c,t,{useGroups:e,forceUpdate:f,skipAssigningAttributes:l,overwriteIndex:s}),f&&t.dispose(),a.set(t,c.map(o=>({version:o.version,uuid:o.uuid})));let u=ke;return f?u=qn:l.includes(!1)&&(u=Wn),{changeType:u,materials:Ps(i),geometry:t}}}function Es(n){const t=new Set;for(let e=0,s=n.length;e<s;e++){const r=n[e];for(const a in r){const i=r[a];i&&i.isTexture&&t.add(i)}}return Array.from(t)}function Fs(n){const t=[],e=new Set;for(let r=0,a=n.length;r<a;r++)n[r].traverse(i=>{i.visible&&(i.isRectAreaLight||i.isSpotLight||i.isPointLight||i.isDirectionalLight)&&(t.push(i),i.iesMap&&e.add(i.iesMap))});const s=Array.from(e).sort((r,a)=>r.uuid<a.uuid?1:r.uuid>a.uuid?-1:0);return{lights:t,iesTextures:s}}class qs{get initialized(){return!!this.bvh}constructor(t){this.bvhOptions={},this.attributes=["position","normal","tangent","color","uv","uv2"],this.generateBVH=!0,this.bvh=null,this.geometry=new mt,this.staticGeometryGenerator=new Cs(t),this._bvhWorker=null,this._pendingGenerate=null,this._buildAsync=!1,this._materialUuids=null}setObjects(t){this.staticGeometryGenerator.setObjects(t)}setBVHWorker(t){this._bvhWorker=t}async generateAsync(t=null){if(!this._bvhWorker)throw new Error('PathTracingSceneGenerator: "setBVHWorker" must be called before "generateAsync" can be called.');if(this.bvh instanceof Promise)return this._pendingGenerate||(this._pendingGenerate=new Promise(async()=>(await this.bvh,this._pendingGenerate=null,this.generateAsync(t)))),this._pendingGenerate;{this._buildAsync=!0;const e=this.generate(t);return this._buildAsync=!1,e.bvh=this.bvh=await e.bvh,e}}generate(t=null){const{staticGeometryGenerator:e,geometry:s,attributes:r}=this,a=e.objects;e.attributes=r,a.forEach(o=>{o.traverse(m=>{m.isSkinnedMesh&&m.skeleton&&m.skeleton.update()})});const i=e.generate(s),l=i.materials;let c=i.changeType!==ke||this._materialUuids===null||this._materialUuids.length!==length;if(!c){for(let o=0,m=l.length;o<m;o++)if(l[o].uuid!==this._materialUuids[o]){c=!0;break}}const d=Es(l),{lights:f,iesTextures:u}=Fs(a);if(c&&(Ts(s,l,l),this._materialUuids=l.map(o=>o.uuid)),this.generateBVH){if(this.bvh instanceof Promise)throw new Error("PathTracingSceneGenerator: BVH is already building asynchronously.");if(i.changeType===qn){const o={strategy:Rn,maxLeafTris:1,indirect:!0,onProgress:t,...this.bvhOptions};this._buildAsync?this.bvh=this._bvhWorker.generate(s,o):this.bvh=new $e(s,o)}else i.changeType===Wn&&this.bvh.refit()}return{bvhChanged:i.changeType!==ke,bvh:this.bvh,needsMaterialIndexUpdate:c,lights:f,iesTextures:u,geometry:s,materials:l,textures:d,objects:a}}}function Xe(n,t){return n.uuid<t.uuid?1:n.uuid>t.uuid?-1:0}function Le(n){return`${n.source.uuid}:${n.colorSpace}`}function zs(n){const t=new Set,e=[];for(let s=0,r=n.length;s<r;s++){const a=n[s],i=Le(a);t.has(i)||(t.add(i),e.push(a))}return e}function $s(n){const t=n.map(s=>s.iesMap||null).filter(s=>s),e=new Set(t);return Array.from(e).sort(Xe)}function Xs(n){const t=new Set;for(let s=0,r=n.length;s<r;s++){const a=n[s];for(const i in a){const l=a[i];l&&l.isTexture&&t.add(l)}}const e=Array.from(t);return zs(e).sort(Xe)}function Gs(n){const t=[];return n.traverse(e=>{e.visible&&(e.isRectAreaLight||e.isSpotLight||e.isPointLight||e.isDirectionalLight)&&t.push(e)}),t.sort(Xe)}const $n=47,_n=$n*4;class Rs{constructor(){this._features={}}isUsed(t){return t in this._features}setUsed(t,e=!0){e===!1?delete this._features[t]:this._features[t]=!0}reset(){this._features={}}}class Ys extends ie{constructor(){super(new Float32Array(4),1,1),this.format=Ut,this.type=It,this.wrapS=Je,this.wrapT=Je,this.minFilter=st,this.magFilter=st,this.generateMipmaps=!1,this.features=new Rs}updateFrom(t,e){function s(g,T,p=-1){if(T in g&&g[T]){const v=Le(g[T]);return u[v]}else return p}function r(g,T,p){return T in g?g[T]:p}function a(g,T,p,v){const h=g[T]&&g[T].isTexture?g[T]:null;if(h){h.matrixAutoUpdate&&h.updateMatrix();const x=h.matrix.elements;let y=0;p[v+y++]=x[0],p[v+y++]=x[3],p[v+y++]=x[6],y++,p[v+y++]=x[1],p[v+y++]=x[4],p[v+y++]=x[7],y++}return 8}let i=0;const l=t.length*$n,c=Math.ceil(Math.sqrt(l))||1,{image:d,features:f}=this,u={};for(let g=0,T=e.length;g<T;g++)u[Le(e[g])]=g;d.width!==c&&(this.dispose(),d.data=new Float32Array(c*c*4),d.width=c,d.height=c);const o=d.data;f.reset();for(let g=0,T=t.length;g<T;g++){const p=t[g];if(p.isFogVolumeMaterial){f.setUsed("FOG");for(let x=0;x<_n;x++)o[i+x]=0;o[i+0+0]=p.color.r,o[i+0+1]=p.color.g,o[i+0+2]=p.color.b,o[i+8+3]=r(p,"emissiveIntensity",0),o[i+12+0]=p.emissive.r,o[i+12+1]=p.emissive.g,o[i+12+2]=p.emissive.b,o[i+52+1]=p.density,o[i+52+3]=0,o[i+56+2]=4,i+=_n;continue}o[i++]=p.color.r,o[i++]=p.color.g,o[i++]=p.color.b,o[i++]=s(p,"map"),o[i++]=r(p,"metalness",0),o[i++]=s(p,"metalnessMap"),o[i++]=r(p,"roughness",0),o[i++]=s(p,"roughnessMap"),o[i++]=r(p,"ior",1.5),o[i++]=r(p,"transmission",0),o[i++]=s(p,"transmissionMap"),o[i++]=r(p,"emissiveIntensity",0),"emissive"in p?(o[i++]=p.emissive.r,o[i++]=p.emissive.g,o[i++]=p.emissive.b):(o[i++]=0,o[i++]=0,o[i++]=0),o[i++]=s(p,"emissiveMap"),o[i++]=s(p,"normalMap"),"normalScale"in p?(o[i++]=p.normalScale.x,o[i++]=p.normalScale.y):(o[i++]=1,o[i++]=1),o[i++]=r(p,"clearcoat",0),o[i++]=s(p,"clearcoatMap"),o[i++]=r(p,"clearcoatRoughness",0),o[i++]=s(p,"clearcoatRoughnessMap"),o[i++]=s(p,"clearcoatNormalMap"),"clearcoatNormalScale"in p?(o[i++]=p.clearcoatNormalScale.x,o[i++]=p.clearcoatNormalScale.y):(o[i++]=1,o[i++]=1),i++,o[i++]=r(p,"sheen",0),"sheenColor"in p?(o[i++]=p.sheenColor.r,o[i++]=p.sheenColor.g,o[i++]=p.sheenColor.b):(o[i++]=0,o[i++]=0,o[i++]=0),o[i++]=s(p,"sheenColorMap"),o[i++]=r(p,"sheenRoughness",0),o[i++]=s(p,"sheenRoughnessMap"),o[i++]=s(p,"iridescenceMap"),o[i++]=s(p,"iridescenceThicknessMap"),o[i++]=r(p,"iridescence",0),o[i++]=r(p,"iridescenceIOR",1.3);const v=r(p,"iridescenceThicknessRange",[100,400]);o[i++]=v[0],o[i++]=v[1],"specularColor"in p?(o[i++]=p.specularColor.r,o[i++]=p.specularColor.g,o[i++]=p.specularColor.b):(o[i++]=1,o[i++]=1,o[i++]=1),o[i++]=s(p,"specularColorMap"),o[i++]=r(p,"specularIntensity",1),o[i++]=s(p,"specularIntensityMap");const h=r(p,"thickness",0)===0&&r(p,"attenuationDistance",1/0)===1/0;if(o[i++]=Number(h),i++,"attenuationColor"in p?(o[i++]=p.attenuationColor.r,o[i++]=p.attenuationColor.g,o[i++]=p.attenuationColor.b):(o[i++]=1,o[i++]=1,o[i++]=1),o[i++]=r(p,"attenuationDistance",1/0),o[i++]=s(p,"alphaMap"),o[i++]=p.opacity,o[i++]=p.alphaTest,!h&&p.transmission>0)o[i++]=0;else switch(p.side){case Se:o[i++]=1;break;case Dn:o[i++]=-1;break;case Cn:o[i++]=0;break}o[i++]=Number(r(p,"matte",!1)),o[i++]=Number(r(p,"castShadow",!0)),o[i++]=Number(p.vertexColors)|Number(p.flatShading)<<1,o[i++]=Number(p.transparent),i+=a(p,"map",o,i),i+=a(p,"metalnessMap",o,i),i+=a(p,"roughnessMap",o,i),i+=a(p,"transmissionMap",o,i),i+=a(p,"emissiveMap",o,i),i+=a(p,"normalMap",o,i),i+=a(p,"clearcoatMap",o,i),i+=a(p,"clearcoatNormalMap",o,i),i+=a(p,"clearcoatRoughnessMap",o,i),i+=a(p,"sheenColorMap",o,i),i+=a(p,"sheenRoughnessMap",o,i),i+=a(p,"iridescenceMap",o,i),i+=a(p,"iridescenceThicknessMap",o,i),i+=a(p,"specularColorMap",o,i),i+=a(p,"specularIntensityMap",o,i),i+=a(p,"alphaMap",o,i)}const m=On(o.buffer);return this.hash!==m?(this.hash=m,this.needsUpdate=!0,!0):!1}}const js=`

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

`,Zs=`

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


`,Ks=`

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
`;export{ks as F,$e as M,qs as P,ds as U,Hs as a,Ws as b,Ls as c,Os as d,Ai as e,Vs as f,$n as g,Xs as h,as as i,Gs as j,$s as k,On as l,js as m,ps as n,Ys as o,Ks as p,Zs as s};
//# sourceMappingURL=pcg.glsl-NPcFUzXG.js.map
