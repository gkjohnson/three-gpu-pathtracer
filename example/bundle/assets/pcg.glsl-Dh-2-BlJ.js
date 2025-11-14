import{X as ln,a3 as In,K as ct,aE as Re,B as O,m as C,ar as un,bz as Z,V as wt,bA as Ft,ai as Pn,l as j,ah as G,bB as fn,A as dn,af as be,b1 as Ut,F as Tt,a as ee,t as et,a_ as re,aS as Le,bC as Cn,b0 as Ve,a$ as Dn,R as Nt,bD as ve,bE as pn,bF as Fn,bo as En,aT as zn,as as Un,aO as Fe,G as kn,w as He}from"./MaterialBase-byhyp4gt.js";const Nn=new In(-1,1,1,-1,0,1);class Rn extends ct{constructor(){super(),this.setAttribute("position",new Re([-1,3,0,-1,-1,0,3,-1,0],3)),this.setAttribute("uv",new Re([0,2,0,0,2,0],2))}}const Ln=new Rn;class di{constructor(t){this._mesh=new ln(Ln,t)}dispose(){this._mesh.geometry.dispose()}render(t){t.render(this._mesh,Nn)}get material(){return this._mesh.material}set material(t){this._mesh.material=t}}const mn=0,Vn=1,hn=2,Oe=2,oe=1.25,We=1,st=32,se=65535,Hn=Math.pow(2,-24),ae=Symbol("SKIP_GENERATION");function xn(n){return n.index?n.index.count:n.attributes.position.count}function At(n){return xn(n)/3}function yn(n,t=ArrayBuffer){return n>65535?new Uint32Array(new t(4*n)):new Uint16Array(new t(2*n))}function On(n,t){if(!n.index){const e=n.attributes.position.count,i=t.useSharedArrayBuffer?SharedArrayBuffer:ArrayBuffer,r=yn(e,i);n.setIndex(new O(r,1));for(let a=0;a<e;a++)r[a]=a}}function gn(n){const t=At(n),e=n.drawRange,i=e.start/3,r=(e.start+e.count)/3,a=Math.max(0,i),s=Math.min(t,r)-a;return[{offset:Math.floor(a),count:Math.floor(s)}]}function bn(n){if(!n.groups||!n.groups.length)return gn(n);const t=[],e=new Set,i=n.drawRange,r=i.start/3,a=(i.start+i.count)/3;for(const c of n.groups){const l=c.start/3,f=(c.start+c.count)/3;e.add(Math.max(r,l)),e.add(Math.min(a,f))}const s=Array.from(e.values()).sort((c,l)=>c-l);for(let c=0;c<s.length-1;c++){const l=s[c],f=s[c+1];t.push({offset:Math.floor(l),count:Math.floor(f-l)})}return t}function Wn(n){if(n.groups.length===0)return!1;const t=At(n),e=bn(n).sort((a,s)=>a.offset-s.offset),i=e[e.length-1];i.count=Math.min(t-i.offset,i.count);let r=0;return e.forEach(({count:a})=>r+=a),t!==r}function ce(n,t,e,i,r){let a=1/0,s=1/0,c=1/0,l=-1/0,f=-1/0,d=-1/0,p=1/0,o=1/0,m=1/0,x=-1/0,b=-1/0,u=-1/0;for(let h=t*6,y=(t+e)*6;h<y;h+=6){const g=n[h+0],T=n[h+1],v=g-T,w=g+T;v<a&&(a=v),w>l&&(l=w),g<p&&(p=g),g>x&&(x=g);const A=n[h+2],_=n[h+3],M=A-_,B=A+_;M<s&&(s=M),B>f&&(f=B),A<o&&(o=A),A>b&&(b=A);const I=n[h+4],S=n[h+5],P=I-S,D=I+S;P<c&&(c=P),D>d&&(d=D),I<m&&(m=I),I>u&&(u=I)}i[0]=a,i[1]=s,i[2]=c,i[3]=l,i[4]=f,i[5]=d,r[0]=p,r[1]=o,r[2]=m,r[3]=x,r[4]=b,r[5]=u}function qn(n,t=null,e=null,i=null){const r=n.attributes.position,a=n.index?n.index.array:null,s=At(n),c=r.normalized;let l;t===null?(l=new Float32Array(s*6*4),e=0,i=s):(l=t,e=e||0,i=i||s);const f=r.array,d=r.offset||0;let p=3;r.isInterleavedBufferAttribute&&(p=r.data.stride);const o=["getX","getY","getZ"];for(let m=e;m<e+i;m++){const x=m*3,b=m*6;let u=x+0,h=x+1,y=x+2;a&&(u=a[u],h=a[h],y=a[y]),c||(u=u*p+d,h=h*p+d,y=y*p+d);for(let g=0;g<3;g++){let T,v,w;c?(T=r[o[g]](u),v=r[o[g]](h),w=r[o[g]](y)):(T=f[u+g],v=f[h+g],w=f[y+g]);let A=T;v<A&&(A=v),w<A&&(A=w);let _=T;v>_&&(_=v),w>_&&(_=w);const M=(_-A)/2,B=g*2;l[b+B+0]=A+M,l[b+B+1]=M+(Math.abs(A)+M)*Hn}}return l}function z(n,t,e){return e.min.x=t[n],e.min.y=t[n+1],e.min.z=t[n+2],e.max.x=t[n+3],e.max.y=t[n+4],e.max.z=t[n+5],e}function qe(n){let t=-1,e=-1/0;for(let i=0;i<3;i++){const r=n[i+3]-n[i];r>e&&(e=r,t=i)}return t}function $e(n,t){t.set(n)}function Xe(n,t,e){let i,r;for(let a=0;a<3;a++){const s=a+3;i=n[a],r=t[a],e[a]=i<r?i:r,i=n[s],r=t[s],e[s]=i>r?i:r}}function Rt(n,t,e){for(let i=0;i<3;i++){const r=t[n+2*i],a=t[n+2*i+1],s=r-a,c=r+a;s<e[i]&&(e[i]=s),c>e[i+3]&&(e[i+3]=c)}}function St(n){const t=n[3]-n[0],e=n[4]-n[1],i=n[5]-n[2];return 2*(t*e+e*i+i*t)}const Y=32,$n=(n,t)=>n.candidate-t.candidate,Q=new Array(Y).fill().map(()=>({count:0,bounds:new Float32Array(6),rightCacheBounds:new Float32Array(6),leftCacheBounds:new Float32Array(6),candidate:0})),Lt=new Float32Array(6);function Xn(n,t,e,i,r,a){let s=-1,c=0;if(a===mn)s=qe(t),s!==-1&&(c=(t[s]+t[s+3])/2);else if(a===Vn)s=qe(n),s!==-1&&(c=jn(e,i,r,s));else if(a===hn){const l=St(n);let f=oe*r;const d=i*6,p=(i+r)*6;for(let o=0;o<3;o++){const m=t[o],u=(t[o+3]-m)/Y;if(r<Y/4){const h=[...Q];h.length=r;let y=0;for(let T=d;T<p;T+=6,y++){const v=h[y];v.candidate=e[T+2*o],v.count=0;const{bounds:w,leftCacheBounds:A,rightCacheBounds:_}=v;for(let M=0;M<3;M++)_[M]=1/0,_[M+3]=-1/0,A[M]=1/0,A[M+3]=-1/0,w[M]=1/0,w[M+3]=-1/0;Rt(T,e,w)}h.sort($n);let g=r;for(let T=0;T<g;T++){const v=h[T];for(;T+1<g&&h[T+1].candidate===v.candidate;)h.splice(T+1,1),g--}for(let T=d;T<p;T+=6){const v=e[T+2*o];for(let w=0;w<g;w++){const A=h[w];v>=A.candidate?Rt(T,e,A.rightCacheBounds):(Rt(T,e,A.leftCacheBounds),A.count++)}}for(let T=0;T<g;T++){const v=h[T],w=v.count,A=r-v.count,_=v.leftCacheBounds,M=v.rightCacheBounds;let B=0;w!==0&&(B=St(_)/l);let I=0;A!==0&&(I=St(M)/l);const S=We+oe*(B*w+I*A);S<f&&(s=o,f=S,c=v.candidate)}}else{for(let g=0;g<Y;g++){const T=Q[g];T.count=0,T.candidate=m+u+g*u;const v=T.bounds;for(let w=0;w<3;w++)v[w]=1/0,v[w+3]=-1/0}for(let g=d;g<p;g+=6){let w=~~((e[g+2*o]-m)/u);w>=Y&&(w=Y-1);const A=Q[w];A.count++,Rt(g,e,A.bounds)}const h=Q[Y-1];$e(h.bounds,h.rightCacheBounds);for(let g=Y-2;g>=0;g--){const T=Q[g],v=Q[g+1];Xe(T.bounds,v.rightCacheBounds,T.rightCacheBounds)}let y=0;for(let g=0;g<Y-1;g++){const T=Q[g],v=T.count,w=T.bounds,_=Q[g+1].rightCacheBounds;v!==0&&(y===0?$e(w,Lt):Xe(w,Lt,Lt)),y+=v;let M=0,B=0;y!==0&&(M=St(Lt)/l);const I=r-y;I!==0&&(B=St(_)/l);const S=We+oe*(M*y+B*I);S<f&&(s=o,f=S,c=T.candidate)}}}}else console.warn(`MeshBVH: Invalid build strategy value ${a} used.`);return{axis:s,pos:c}}function jn(n,t,e,i){let r=0;for(let a=t,s=t+e;a<s;a++)r+=n[a*6+i*2];return r/e}class le{constructor(){this.boundingData=new Float32Array(6)}}function Gn(n,t,e,i,r,a){let s=i,c=i+r-1;const l=a.pos,f=a.axis*2;for(;;){for(;s<=c&&e[s*6+f]<l;)s++;for(;s<=c&&e[c*6+f]>=l;)c--;if(s<c){for(let d=0;d<3;d++){let p=t[s*3+d];t[s*3+d]=t[c*3+d],t[c*3+d]=p}for(let d=0;d<6;d++){let p=e[s*6+d];e[s*6+d]=e[c*6+d],e[c*6+d]=p}s++,c--}else return s}}function Yn(n,t,e,i,r,a){let s=i,c=i+r-1;const l=a.pos,f=a.axis*2;for(;;){for(;s<=c&&e[s*6+f]<l;)s++;for(;s<=c&&e[c*6+f]>=l;)c--;if(s<c){let d=n[s];n[s]=n[c],n[c]=d;for(let p=0;p<6;p++){let o=e[s*6+p];e[s*6+p]=e[c*6+p],e[c*6+p]=o}s++,c--}else return s}}function N(n,t){return t[n+15]===65535}function L(n,t){return t[n+6]}function V(n,t){return t[n+14]}function W(n){return n+8}function H(n,t){return t[n+6]}function Ee(n,t){return t[n+7]}let vn,Et,te,Tn;const Zn=Math.pow(2,32);function Te(n){return"count"in n?1:1+Te(n.left)+Te(n.right)}function Kn(n,t,e){return vn=new Float32Array(e),Et=new Uint32Array(e),te=new Uint16Array(e),Tn=new Uint8Array(e),we(n,t)}function we(n,t){const e=n/4,i=n/2,r="count"in t,a=t.boundingData;for(let s=0;s<6;s++)vn[e+s]=a[s];if(r)if(t.buffer){const s=t.buffer;Tn.set(new Uint8Array(s),n);for(let c=n,l=n+s.byteLength;c<l;c+=st){const f=c/2;N(f,te)||(Et[c/4+6]+=e)}return n+s.byteLength}else{const s=t.offset,c=t.count;return Et[e+6]=s,te[i+14]=c,te[i+15]=se,n+st}else{const s=t.left,c=t.right,l=t.splitAxis;let f;if(f=we(n+st,s),f/4>Zn)throw new Error("MeshBVH: Cannot store child pointer greater than 32 bits.");return Et[e+6]=f/4,f=we(f,c),Et[e+7]=l,f}}function Jn(n,t){const e=(n.index?n.index.count:n.attributes.position.count)/3,i=e>2**16,r=i?4:2,a=t?new SharedArrayBuffer(e*r):new ArrayBuffer(e*r),s=i?new Uint32Array(a):new Uint16Array(a);for(let c=0,l=s.length;c<l;c++)s[c]=c;return s}function Qn(n,t,e,i,r){const{maxDepth:a,verbose:s,maxLeafTris:c,strategy:l,onProgress:f,indirect:d}=r,p=n._indirectBuffer,o=n.geometry,m=o.index?o.index.array:null,x=d?Yn:Gn,b=At(o),u=new Float32Array(6);let h=!1;const y=new le;return ce(t,e,i,y.boundingData,u),T(y,e,i,u),y;function g(v){f&&f(v/b)}function T(v,w,A,_=null,M=0){if(!h&&M>=a&&(h=!0,s&&(console.warn(`MeshBVH: Max depth of ${a} reached when generating BVH. Consider increasing maxDepth.`),console.warn(o))),A<=c||M>=a)return g(w+A),v.offset=w,v.count=A,v;const B=Xn(v.boundingData,_,t,w,A,l);if(B.axis===-1)return g(w+A),v.offset=w,v.count=A,v;const I=x(p,m,t,w,A,B);if(I===w||I===w+A)g(w+A),v.offset=w,v.count=A;else{v.splitAxis=B.axis;const S=new le,P=w,D=I-w;v.left=S,ce(t,P,D,S.boundingData,u),T(S,P,D,u,M+1);const F=new le,U=I,J=A-D;v.right=F,ce(t,U,J,F.boundingData,u),T(F,U,J,u,M+1)}return v}}function ts(n,t){const e=n.geometry;t.indirect&&(n._indirectBuffer=Jn(e,t.useSharedArrayBuffer),Wn(e)&&!t.verbose&&console.warn('MeshBVH: Provided geometry contains groups that do not fully span the vertex contents while using the "indirect" option. BVH may incorrectly report intersections on unrendered portions of the geometry.')),n._indirectBuffer||On(e,t);const i=t.useSharedArrayBuffer?SharedArrayBuffer:ArrayBuffer,r=qn(e),a=t.indirect?gn(e):bn(e);n._roots=a.map(s=>{const c=Qn(n,r,s.offset,s.count,t),l=Te(c),f=new i(st*l);return Kn(0,c,f),f})}class K{constructor(){this.min=1/0,this.max=-1/0}setFromPointsField(t,e){let i=1/0,r=-1/0;for(let a=0,s=t.length;a<s;a++){const l=t[a][e];i=l<i?l:i,r=l>r?l:r}this.min=i,this.max=r}setFromPoints(t,e){let i=1/0,r=-1/0;for(let a=0,s=e.length;a<s;a++){const c=e[a],l=t.dot(c);i=l<i?l:i,r=l>r?l:r}this.min=i,this.max=r}isSeparated(t){return this.min>t.max||t.min>this.max}}K.prototype.setFromBox=(function(){const n=new C;return function(e,i){const r=i.min,a=i.max;let s=1/0,c=-1/0;for(let l=0;l<=1;l++)for(let f=0;f<=1;f++)for(let d=0;d<=1;d++){n.x=r.x*l+a.x*(1-l),n.y=r.y*f+a.y*(1-f),n.z=r.z*d+a.z*(1-d);const p=e.dot(n);s=Math.min(p,s),c=Math.max(p,c)}this.min=s,this.max=c}})();const es=(function(){const n=new C,t=new C,e=new C;return function(r,a,s){const c=r.start,l=n,f=a.start,d=t;e.subVectors(c,f),n.subVectors(r.end,r.start),t.subVectors(a.end,a.start);const p=e.dot(d),o=d.dot(l),m=d.dot(d),x=e.dot(l),u=l.dot(l)*m-o*o;let h,y;u!==0?h=(p*o-x*m)/u:h=0,y=(p+h*o)/m,s.x=h,s.y=y}})(),ze=(function(){const n=new wt,t=new C,e=new C;return function(r,a,s,c){es(r,a,n);let l=n.x,f=n.y;if(l>=0&&l<=1&&f>=0&&f<=1){r.at(l,s),a.at(f,c);return}else if(l>=0&&l<=1){f<0?a.at(0,c):a.at(1,c),r.closestPointToPoint(c,!0,s);return}else if(f>=0&&f<=1){l<0?r.at(0,s):r.at(1,s),a.closestPointToPoint(s,!0,c);return}else{let d;l<0?d=r.start:d=r.end;let p;f<0?p=a.start:p=a.end;const o=t,m=e;if(r.closestPointToPoint(p,!0,t),a.closestPointToPoint(d,!0,e),o.distanceToSquared(p)<=m.distanceToSquared(d)){s.copy(o),c.copy(p);return}else{s.copy(d),c.copy(m);return}}}})(),ns=(function(){const n=new C,t=new C,e=new un,i=new Z;return function(a,s){const{radius:c,center:l}=a,{a:f,b:d,c:p}=s;if(i.start=f,i.end=d,i.closestPointToPoint(l,!0,n).distanceTo(l)<=c||(i.start=f,i.end=p,i.closestPointToPoint(l,!0,n).distanceTo(l)<=c)||(i.start=d,i.end=p,i.closestPointToPoint(l,!0,n).distanceTo(l)<=c))return!0;const b=s.getPlane(e);if(Math.abs(b.distanceToPoint(l))<=c){const h=b.projectPoint(l,t);if(s.containsPoint(h))return!0}return!1}})(),ss=1e-15;function ue(n){return Math.abs(n)<ss}class X extends Ft{constructor(...t){super(...t),this.isExtendedTriangle=!0,this.satAxes=new Array(4).fill().map(()=>new C),this.satBounds=new Array(4).fill().map(()=>new K),this.points=[this.a,this.b,this.c],this.sphere=new Pn,this.plane=new un,this.needsUpdate=!0}intersectsSphere(t){return ns(t,this)}update(){const t=this.a,e=this.b,i=this.c,r=this.points,a=this.satAxes,s=this.satBounds,c=a[0],l=s[0];this.getNormal(c),l.setFromPoints(c,r);const f=a[1],d=s[1];f.subVectors(t,e),d.setFromPoints(f,r);const p=a[2],o=s[2];p.subVectors(e,i),o.setFromPoints(p,r);const m=a[3],x=s[3];m.subVectors(i,t),x.setFromPoints(m,r),this.sphere.setFromPoints(this.points),this.plane.setFromNormalAndCoplanarPoint(c,t),this.needsUpdate=!1}}X.prototype.closestPointToSegment=(function(){const n=new C,t=new C,e=new Z;return function(r,a=null,s=null){const{start:c,end:l}=r,f=this.points;let d,p=1/0;for(let o=0;o<3;o++){const m=(o+1)%3;e.start.copy(f[o]),e.end.copy(f[m]),ze(e,r,n,t),d=n.distanceToSquared(t),d<p&&(p=d,a&&a.copy(n),s&&s.copy(t))}return this.closestPointToPoint(c,n),d=c.distanceToSquared(n),d<p&&(p=d,a&&a.copy(n),s&&s.copy(c)),this.closestPointToPoint(l,n),d=l.distanceToSquared(n),d<p&&(p=d,a&&a.copy(n),s&&s.copy(l)),Math.sqrt(p)}})();X.prototype.intersectsTriangle=(function(){const n=new X,t=new Array(3),e=new Array(3),i=new K,r=new K,a=new C,s=new C,c=new C,l=new C,f=new C,d=new Z,p=new Z,o=new Z,m=new C;function x(b,u,h){const y=b.points;let g=0,T=-1;for(let v=0;v<3;v++){const{start:w,end:A}=d;w.copy(y[v]),A.copy(y[(v+1)%3]),d.delta(s);const _=ue(u.distanceToPoint(w));if(ue(u.normal.dot(s))&&_){h.copy(d),g=2;break}const M=u.intersectLine(d,m);if(!M&&_&&m.copy(w),(M||_)&&!ue(m.distanceTo(A))){if(g<=1)(g===1?h.start:h.end).copy(m),_&&(T=g);else if(g>=2){(T===1?h.start:h.end).copy(m),g=2;break}if(g++,g===2&&T===-1)break}}return g}return function(u,h=null,y=!1){this.needsUpdate&&this.update(),u.isExtendedTriangle?u.needsUpdate&&u.update():(n.copy(u),n.update(),u=n);const g=this.plane,T=u.plane;if(Math.abs(g.normal.dot(T.normal))>1-1e-10){const v=this.satBounds,w=this.satAxes;e[0]=u.a,e[1]=u.b,e[2]=u.c;for(let M=0;M<4;M++){const B=v[M],I=w[M];if(i.setFromPoints(I,e),B.isSeparated(i))return!1}const A=u.satBounds,_=u.satAxes;t[0]=this.a,t[1]=this.b,t[2]=this.c;for(let M=0;M<4;M++){const B=A[M],I=_[M];if(i.setFromPoints(I,t),B.isSeparated(i))return!1}for(let M=0;M<4;M++){const B=w[M];for(let I=0;I<4;I++){const S=_[I];if(a.crossVectors(B,S),i.setFromPoints(a,t),r.setFromPoints(a,e),i.isSeparated(r))return!1}}return h&&(y||console.warn("ExtendedTriangle.intersectsTriangle: Triangles are coplanar which does not support an output edge. Setting edge to 0, 0, 0."),h.start.set(0,0,0),h.end.set(0,0,0)),!0}else{const v=x(this,T,p);if(v===1&&u.containsPoint(p.end))return h&&(h.start.copy(p.end),h.end.copy(p.end)),!0;if(v!==2)return!1;const w=x(u,g,o);if(w===1&&this.containsPoint(o.end))return h&&(h.start.copy(o.end),h.end.copy(o.end)),!0;if(w!==2)return!1;if(p.delta(c),o.delta(l),c.dot(l)<0){let P=o.start;o.start=o.end,o.end=P}const A=p.start.dot(c),_=p.end.dot(c),M=o.start.dot(c),B=o.end.dot(c),I=_<M,S=A<B;return A!==B&&M!==_&&I===S?!1:(h&&(f.subVectors(p.start,o.start),f.dot(c)>0?h.start.copy(p.start):h.start.copy(o.start),f.subVectors(p.end,o.end),f.dot(c)<0?h.end.copy(p.end):h.end.copy(o.end)),!0)}}})();X.prototype.distanceToPoint=(function(){const n=new C;return function(e){return this.closestPointToPoint(e,n),e.distanceTo(n)}})();X.prototype.distanceToTriangle=(function(){const n=new C,t=new C,e=["a","b","c"],i=new Z,r=new Z;return function(s,c=null,l=null){const f=c||l?i:null;if(this.intersectsTriangle(s,f))return(c||l)&&(c&&f.getCenter(c),l&&f.getCenter(l)),0;let d=1/0;for(let p=0;p<3;p++){let o;const m=e[p],x=s[m];this.closestPointToPoint(x,n),o=x.distanceToSquared(n),o<d&&(d=o,c&&c.copy(n),l&&l.copy(x));const b=this[m];s.closestPointToPoint(b,n),o=b.distanceToSquared(n),o<d&&(d=o,c&&c.copy(b),l&&l.copy(n))}for(let p=0;p<3;p++){const o=e[p],m=e[(p+1)%3];i.set(this[o],this[m]);for(let x=0;x<3;x++){const b=e[x],u=e[(x+1)%3];r.set(s[b],s[u]),ze(i,r,n,t);const h=n.distanceToSquared(t);h<d&&(d=h,c&&c.copy(n),l&&l.copy(t))}}return Math.sqrt(d)}})();class R{constructor(t,e,i){this.isOrientedBox=!0,this.min=new C,this.max=new C,this.matrix=new j,this.invMatrix=new j,this.points=new Array(8).fill().map(()=>new C),this.satAxes=new Array(3).fill().map(()=>new C),this.satBounds=new Array(3).fill().map(()=>new K),this.alignedSatBounds=new Array(3).fill().map(()=>new K),this.needsUpdate=!1,t&&this.min.copy(t),e&&this.max.copy(e),i&&this.matrix.copy(i)}set(t,e,i){this.min.copy(t),this.max.copy(e),this.matrix.copy(i),this.needsUpdate=!0}copy(t){this.min.copy(t.min),this.max.copy(t.max),this.matrix.copy(t.matrix),this.needsUpdate=!0}}R.prototype.update=(function(){return function(){const t=this.matrix,e=this.min,i=this.max,r=this.points;for(let f=0;f<=1;f++)for(let d=0;d<=1;d++)for(let p=0;p<=1;p++){const o=1*f|2*d|4*p,m=r[o];m.x=f?i.x:e.x,m.y=d?i.y:e.y,m.z=p?i.z:e.z,m.applyMatrix4(t)}const a=this.satBounds,s=this.satAxes,c=r[0];for(let f=0;f<3;f++){const d=s[f],p=a[f],o=1<<f,m=r[o];d.subVectors(c,m),p.setFromPoints(d,r)}const l=this.alignedSatBounds;l[0].setFromPointsField(r,"x"),l[1].setFromPointsField(r,"y"),l[2].setFromPointsField(r,"z"),this.invMatrix.copy(this.matrix).invert(),this.needsUpdate=!1}})();R.prototype.intersectsBox=(function(){const n=new K;return function(e){this.needsUpdate&&this.update();const i=e.min,r=e.max,a=this.satBounds,s=this.satAxes,c=this.alignedSatBounds;if(n.min=i.x,n.max=r.x,c[0].isSeparated(n)||(n.min=i.y,n.max=r.y,c[1].isSeparated(n))||(n.min=i.z,n.max=r.z,c[2].isSeparated(n)))return!1;for(let l=0;l<3;l++){const f=s[l],d=a[l];if(n.setFromBox(f,e),d.isSeparated(n))return!1}return!0}})();R.prototype.intersectsTriangle=(function(){const n=new X,t=new Array(3),e=new K,i=new K,r=new C;return function(s){this.needsUpdate&&this.update(),s.isExtendedTriangle?s.needsUpdate&&s.update():(n.copy(s),n.update(),s=n);const c=this.satBounds,l=this.satAxes;t[0]=s.a,t[1]=s.b,t[2]=s.c;for(let o=0;o<3;o++){const m=c[o],x=l[o];if(e.setFromPoints(x,t),m.isSeparated(e))return!1}const f=s.satBounds,d=s.satAxes,p=this.points;for(let o=0;o<3;o++){const m=f[o],x=d[o];if(e.setFromPoints(x,p),m.isSeparated(e))return!1}for(let o=0;o<3;o++){const m=l[o];for(let x=0;x<4;x++){const b=d[x];if(r.crossVectors(m,b),e.setFromPoints(r,t),i.setFromPoints(r,p),e.isSeparated(i))return!1}}return!0}})();R.prototype.closestPointToPoint=(function(){return function(t,e){return this.needsUpdate&&this.update(),e.copy(t).applyMatrix4(this.invMatrix).clamp(this.min,this.max).applyMatrix4(this.matrix),e}})();R.prototype.distanceToPoint=(function(){const n=new C;return function(e){return this.closestPointToPoint(e,n),e.distanceTo(n)}})();R.prototype.distanceToBox=(function(){const n=["x","y","z"],t=new Array(12).fill().map(()=>new Z),e=new Array(12).fill().map(()=>new Z),i=new C,r=new C;return function(s,c=0,l=null,f=null){if(this.needsUpdate&&this.update(),this.intersectsBox(s))return(l||f)&&(s.getCenter(r),this.closestPointToPoint(r,i),s.closestPointToPoint(i,r),l&&l.copy(i),f&&f.copy(r)),0;const d=c*c,p=s.min,o=s.max,m=this.points;let x=1/0;for(let u=0;u<8;u++){const h=m[u];r.copy(h).clamp(p,o);const y=h.distanceToSquared(r);if(y<x&&(x=y,l&&l.copy(h),f&&f.copy(r),y<d))return Math.sqrt(y)}let b=0;for(let u=0;u<3;u++)for(let h=0;h<=1;h++)for(let y=0;y<=1;y++){const g=(u+1)%3,T=(u+2)%3,v=h<<g|y<<T,w=1<<u|h<<g|y<<T,A=m[v],_=m[w];t[b].set(A,_);const B=n[u],I=n[g],S=n[T],P=e[b],D=P.start,F=P.end;D[B]=p[B],D[I]=h?p[I]:o[I],D[S]=y?p[S]:o[I],F[B]=o[B],F[I]=h?p[I]:o[I],F[S]=y?p[S]:o[I],b++}for(let u=0;u<=1;u++)for(let h=0;h<=1;h++)for(let y=0;y<=1;y++){r.x=u?o.x:p.x,r.y=h?o.y:p.y,r.z=y?o.z:p.z,this.closestPointToPoint(r,i);const g=r.distanceToSquared(i);if(g<x&&(x=g,l&&l.copy(i),f&&f.copy(r),g<d))return Math.sqrt(g)}for(let u=0;u<12;u++){const h=t[u];for(let y=0;y<12;y++){const g=e[y];ze(h,g,i,r);const T=i.distanceToSquared(r);if(T<x&&(x=T,l&&l.copy(i),f&&f.copy(r),T<d))return Math.sqrt(T)}}return Math.sqrt(x)}})();class Ue{constructor(t){this._getNewPrimitive=t,this._primitives=[]}getPrimitive(){const t=this._primitives;return t.length===0?this._getNewPrimitive():t.pop()}releasePrimitive(t){this._primitives.push(t)}}class is extends Ue{constructor(){super(()=>new X)}}const q=new is;class rs{constructor(){this.float32Array=null,this.uint16Array=null,this.uint32Array=null;const t=[];let e=null;this.setBuffer=i=>{e&&t.push(e),e=i,this.float32Array=new Float32Array(i),this.uint16Array=new Uint16Array(i),this.uint32Array=new Uint32Array(i)},this.clearBuffer=()=>{e=null,this.float32Array=null,this.uint16Array=null,this.uint32Array=null,t.length!==0&&this.setBuffer(t.pop())}}}const E=new rs;let nt,vt;const lt=[],Vt=new Ue(()=>new G);function os(n,t,e,i,r,a){nt=Vt.getPrimitive(),vt=Vt.getPrimitive(),lt.push(nt,vt),E.setBuffer(n._roots[t]);const s=Ae(0,n.geometry,e,i,r,a);E.clearBuffer(),Vt.releasePrimitive(nt),Vt.releasePrimitive(vt),lt.pop(),lt.pop();const c=lt.length;return c>0&&(vt=lt[c-1],nt=lt[c-2]),s}function Ae(n,t,e,i,r=null,a=0,s=0){const{float32Array:c,uint16Array:l,uint32Array:f}=E;let d=n*2;if(N(d,l)){const o=L(n,f),m=V(d,l);return z(n,c,nt),i(o,m,!1,s,a+n,nt)}else{let B=function(S){const{uint16Array:P,uint32Array:D}=E;let F=S*2;for(;!N(F,P);)S=W(S),F=S*2;return L(S,D)},I=function(S){const{uint16Array:P,uint32Array:D}=E;let F=S*2;for(;!N(F,P);)S=H(S,D),F=S*2;return L(S,D)+V(F,P)};const o=W(n),m=H(n,f);let x=o,b=m,u,h,y,g;if(r&&(y=nt,g=vt,z(x,c,y),z(b,c,g),u=r(y),h=r(g),h<u)){x=m,b=o;const S=u;u=h,h=S,y=g}y||(y=nt,z(x,c,y));const T=N(x*2,l),v=e(y,T,u,s+1,a+x);let w;if(v===Oe){const S=B(x),D=I(x)-S;w=i(S,D,!0,s+1,a+x,y)}else w=v&&Ae(x,t,e,i,r,a,s+1);if(w)return!0;g=vt,z(b,c,g);const A=N(b*2,l),_=e(g,A,h,s+1,a+b);let M;if(_===Oe){const S=B(b),D=I(b)-S;M=i(S,D,!0,s+1,a+b,g)}else M=_&&Ae(b,t,e,i,r,a,s+1);return!!M}}const Bt=new C,fe=new C;function as(n,t,e={},i=0,r=1/0){const a=i*i,s=r*r;let c=1/0,l=null;if(n.shapecast({boundsTraverseOrder:d=>(Bt.copy(t).clamp(d.min,d.max),Bt.distanceToSquared(t)),intersectsBounds:(d,p,o)=>o<c&&o<s,intersectsTriangle:(d,p)=>{d.closestPointToPoint(t,Bt);const o=t.distanceToSquared(Bt);return o<c&&(fe.copy(Bt),c=o,l=p),o<a}}),c===1/0)return null;const f=Math.sqrt(c);return e.point?e.point.copy(fe):e.point=fe.clone(),e.distance=f,e.faceIndex=l,e}const ut=new C,ft=new C,dt=new C,Ht=new wt,Ot=new wt,Wt=new wt,je=new C,Ge=new C,Ye=new C,qt=new C;function cs(n,t,e,i,r,a){let s;return a===fn?s=n.intersectTriangle(i,e,t,!0,r):s=n.intersectTriangle(t,e,i,a!==dn,r),s===null?null:{distance:n.origin.distanceTo(r),point:r.clone()}}function ls(n,t,e,i,r,a,s,c,l){ut.fromBufferAttribute(t,a),ft.fromBufferAttribute(t,s),dt.fromBufferAttribute(t,c);const f=cs(n,ut,ft,dt,qt,l);if(f){i&&(Ht.fromBufferAttribute(i,a),Ot.fromBufferAttribute(i,s),Wt.fromBufferAttribute(i,c),f.uv=Ft.getInterpolation(qt,ut,ft,dt,Ht,Ot,Wt,new wt)),r&&(Ht.fromBufferAttribute(r,a),Ot.fromBufferAttribute(r,s),Wt.fromBufferAttribute(r,c),f.uv1=Ft.getInterpolation(qt,ut,ft,dt,Ht,Ot,Wt,new wt)),e&&(je.fromBufferAttribute(e,a),Ge.fromBufferAttribute(e,s),Ye.fromBufferAttribute(e,c),f.normal=Ft.getInterpolation(qt,ut,ft,dt,je,Ge,Ye,new C),f.normal.dot(n.direction)>0&&f.normal.multiplyScalar(-1));const d={a,b:s,c,normal:new C,materialIndex:0};Ft.getNormal(ut,ft,dt,d.normal),f.face=d,f.faceIndex=a}return f}function ie(n,t,e,i,r){const a=i*3;let s=a+0,c=a+1,l=a+2;const f=n.index;n.index&&(s=f.getX(s),c=f.getX(c),l=f.getX(l));const{position:d,normal:p,uv:o,uv1:m}=n.attributes,x=ls(e,d,p,o,m,s,c,l,t);return x?(x.faceIndex=i,r&&r.push(x),x):null}function k(n,t,e,i){const r=n.a,a=n.b,s=n.c;let c=t,l=t+1,f=t+2;e&&(c=e.getX(c),l=e.getX(l),f=e.getX(f)),r.x=i.getX(c),r.y=i.getY(c),r.z=i.getZ(c),a.x=i.getX(l),a.y=i.getY(l),a.z=i.getZ(l),s.x=i.getX(f),s.y=i.getY(f),s.z=i.getZ(f)}function us(n,t,e,i,r,a){const{geometry:s,_indirectBuffer:c}=n;for(let l=i,f=i+r;l<f;l++)ie(s,t,e,l,a)}function fs(n,t,e,i,r){const{geometry:a,_indirectBuffer:s}=n;let c=1/0,l=null;for(let f=i,d=i+r;f<d;f++){let p;p=ie(a,t,e,f),p&&p.distance<c&&(l=p,c=p.distance)}return l}function ds(n,t,e,i,r,a,s){const{geometry:c}=e,{index:l}=c,f=c.attributes.position;for(let d=n,p=t+n;d<p;d++){let o;if(o=d,k(s,o*3,l,f),s.needsUpdate=!0,i(s,o,r,a))return!0}return!1}function ps(n,t=null){t&&Array.isArray(t)&&(t=new Set(t));const e=n.geometry,i=e.index?e.index.array:null,r=e.attributes.position;let a,s,c,l,f=0;const d=n._roots;for(let o=0,m=d.length;o<m;o++)a=d[o],s=new Uint32Array(a),c=new Uint16Array(a),l=new Float32Array(a),p(0,f),f+=a.byteLength;function p(o,m,x=!1){const b=o*2;if(c[b+15]===se){const h=s[o+6],y=c[b+14];let g=1/0,T=1/0,v=1/0,w=-1/0,A=-1/0,_=-1/0;for(let M=3*h,B=3*(h+y);M<B;M++){let I=i[M];const S=r.getX(I),P=r.getY(I),D=r.getZ(I);S<g&&(g=S),S>w&&(w=S),P<T&&(T=P),P>A&&(A=P),D<v&&(v=D),D>_&&(_=D)}return l[o+0]!==g||l[o+1]!==T||l[o+2]!==v||l[o+3]!==w||l[o+4]!==A||l[o+5]!==_?(l[o+0]=g,l[o+1]=T,l[o+2]=v,l[o+3]=w,l[o+4]=A,l[o+5]=_,!0):!1}else{const h=o+8,y=s[o+6],g=h+m,T=y+m;let v=x,w=!1,A=!1;t?v||(w=t.has(g),A=t.has(T),v=!w&&!A):(w=!0,A=!0);const _=v||w,M=v||A;let B=!1;_&&(B=p(h,m,v));let I=!1;M&&(I=p(y,m,v));const S=B||I;if(S)for(let P=0;P<3;P++){const D=h+P,F=y+P,U=l[D],J=l[D+3],Mt=l[F],_t=l[F+3];l[o+P]=U<Mt?U:Mt,l[o+P+3]=J>_t?J:_t}return S}}}function it(n,t,e){let i,r,a,s,c,l;const f=1/e.direction.x,d=1/e.direction.y,p=1/e.direction.z,o=e.origin.x,m=e.origin.y,x=e.origin.z;let b=t[n],u=t[n+3],h=t[n+1],y=t[n+3+1],g=t[n+2],T=t[n+3+2];return f>=0?(i=(b-o)*f,r=(u-o)*f):(i=(u-o)*f,r=(b-o)*f),d>=0?(a=(h-m)*d,s=(y-m)*d):(a=(y-m)*d,s=(h-m)*d),!(i>s||a>r||((a>i||isNaN(i))&&(i=a),(s<r||isNaN(r))&&(r=s),p>=0?(c=(g-x)*p,l=(T-x)*p):(c=(T-x)*p,l=(g-x)*p),i>l||c>r)||((l<r||r!==r)&&(r=l),r<0))}function ms(n,t,e,i,r,a){const{geometry:s,_indirectBuffer:c}=n;for(let l=i,f=i+r;l<f;l++){let d=c?c[l]:l;ie(s,t,e,d,a)}}function hs(n,t,e,i,r){const{geometry:a,_indirectBuffer:s}=n;let c=1/0,l=null;for(let f=i,d=i+r;f<d;f++){let p;p=ie(a,t,e,s?s[f]:f),p&&p.distance<c&&(l=p,c=p.distance)}return l}function xs(n,t,e,i,r,a,s){const{geometry:c}=e,{index:l}=c,f=c.attributes.position;for(let d=n,p=t+n;d<p;d++){let o;if(o=e.resolveTriangleIndex(d),k(s,o*3,l,f),s.needsUpdate=!0,i(s,o,r,a))return!0}return!1}function ys(n,t,e,i,r){E.setBuffer(n._roots[t]),Me(0,n,e,i,r),E.clearBuffer()}function Me(n,t,e,i,r){const{float32Array:a,uint16Array:s,uint32Array:c}=E,l=n*2;if(N(l,s)){const d=L(n,c),p=V(l,s);us(t,e,i,d,p,r)}else{const d=W(n);it(d,a,i)&&Me(d,t,e,i,r);const p=H(n,c);it(p,a,i)&&Me(p,t,e,i,r)}}const gs=["x","y","z"];function bs(n,t,e,i){E.setBuffer(n._roots[t]);const r=_e(0,n,e,i);return E.clearBuffer(),r}function _e(n,t,e,i){const{float32Array:r,uint16Array:a,uint32Array:s}=E;let c=n*2;if(N(c,a)){const f=L(n,s),d=V(c,a);return fs(t,e,i,f,d)}else{const f=Ee(n,s),d=gs[f],o=i.direction[d]>=0;let m,x;o?(m=W(n),x=H(n,s)):(m=H(n,s),x=W(n));const u=it(m,r,i)?_e(m,t,e,i):null;if(u){const g=u.point[d];if(o?g<=r[x+f]:g>=r[x+f+3])return u}const y=it(x,r,i)?_e(x,t,e,i):null;return u&&y?u.distance<=y.distance?u:y:u||y||null}}const $t=new G,pt=new X,mt=new X,It=new j,Ze=new R,Xt=new R;function vs(n,t,e,i){E.setBuffer(n._roots[t]);const r=Se(0,n,e,i);return E.clearBuffer(),r}function Se(n,t,e,i,r=null){const{float32Array:a,uint16Array:s,uint32Array:c}=E;let l=n*2;if(r===null&&(e.boundingBox||e.computeBoundingBox(),Ze.set(e.boundingBox.min,e.boundingBox.max,i),r=Ze),N(l,s)){const d=t.geometry,p=d.index,o=d.attributes.position,m=e.index,x=e.attributes.position,b=L(n,c),u=V(l,s);if(It.copy(i).invert(),e.boundsTree)return z(n,a,Xt),Xt.matrix.copy(It),Xt.needsUpdate=!0,e.boundsTree.shapecast({intersectsBounds:y=>Xt.intersectsBox(y),intersectsTriangle:y=>{y.a.applyMatrix4(i),y.b.applyMatrix4(i),y.c.applyMatrix4(i),y.needsUpdate=!0;for(let g=b*3,T=(u+b)*3;g<T;g+=3)if(k(mt,g,p,o),mt.needsUpdate=!0,y.intersectsTriangle(mt))return!0;return!1}});for(let h=b*3,y=(u+b)*3;h<y;h+=3){k(pt,h,p,o),pt.a.applyMatrix4(It),pt.b.applyMatrix4(It),pt.c.applyMatrix4(It),pt.needsUpdate=!0;for(let g=0,T=m.count;g<T;g+=3)if(k(mt,g,m,x),mt.needsUpdate=!0,pt.intersectsTriangle(mt))return!0}}else{const d=n+8,p=c[n+6];return z(d,a,$t),!!(r.intersectsBox($t)&&Se(d,t,e,i,r)||(z(p,a,$t),r.intersectsBox($t)&&Se(p,t,e,i,r)))}}const jt=new j,de=new R,Pt=new R,Ts=new C,ws=new C,As=new C,Ms=new C;function _s(n,t,e,i={},r={},a=0,s=1/0){t.boundingBox||t.computeBoundingBox(),de.set(t.boundingBox.min,t.boundingBox.max,e),de.needsUpdate=!0;const c=n.geometry,l=c.attributes.position,f=c.index,d=t.attributes.position,p=t.index,o=q.getPrimitive(),m=q.getPrimitive();let x=Ts,b=ws,u=null,h=null;r&&(u=As,h=Ms);let y=1/0,g=null,T=null;return jt.copy(e).invert(),Pt.matrix.copy(jt),n.shapecast({boundsTraverseOrder:v=>de.distanceToBox(v),intersectsBounds:(v,w,A)=>A<y&&A<s?(w&&(Pt.min.copy(v.min),Pt.max.copy(v.max),Pt.needsUpdate=!0),!0):!1,intersectsRange:(v,w)=>{if(t.boundsTree)return t.boundsTree.shapecast({boundsTraverseOrder:_=>Pt.distanceToBox(_),intersectsBounds:(_,M,B)=>B<y&&B<s,intersectsRange:(_,M)=>{for(let B=_,I=_+M;B<I;B++){k(m,3*B,p,d),m.a.applyMatrix4(e),m.b.applyMatrix4(e),m.c.applyMatrix4(e),m.needsUpdate=!0;for(let S=v,P=v+w;S<P;S++){k(o,3*S,f,l),o.needsUpdate=!0;const D=o.distanceToTriangle(m,x,u);if(D<y&&(b.copy(x),h&&h.copy(u),y=D,g=S,T=B),D<a)return!0}}}});{const A=At(t);for(let _=0,M=A;_<M;_++){k(m,3*_,p,d),m.a.applyMatrix4(e),m.b.applyMatrix4(e),m.c.applyMatrix4(e),m.needsUpdate=!0;for(let B=v,I=v+w;B<I;B++){k(o,3*B,f,l),o.needsUpdate=!0;const S=o.distanceToTriangle(m,x,u);if(S<y&&(b.copy(x),h&&h.copy(u),y=S,g=B,T=_),S<a)return!0}}}}}),q.releasePrimitive(o),q.releasePrimitive(m),y===1/0?null:(i.point?i.point.copy(b):i.point=b.clone(),i.distance=y,i.faceIndex=g,r&&(r.point?r.point.copy(h):r.point=h.clone(),r.point.applyMatrix4(jt),b.applyMatrix4(jt),r.distance=b.sub(r.point).length(),r.faceIndex=T),i)}function Ss(n,t=null){t&&Array.isArray(t)&&(t=new Set(t));const e=n.geometry,i=e.index?e.index.array:null,r=e.attributes.position;let a,s,c,l,f=0;const d=n._roots;for(let o=0,m=d.length;o<m;o++)a=d[o],s=new Uint32Array(a),c=new Uint16Array(a),l=new Float32Array(a),p(0,f),f+=a.byteLength;function p(o,m,x=!1){const b=o*2;if(c[b+15]===se){const h=s[o+6],y=c[b+14];let g=1/0,T=1/0,v=1/0,w=-1/0,A=-1/0,_=-1/0;for(let M=h,B=h+y;M<B;M++){const I=3*n.resolveTriangleIndex(M);for(let S=0;S<3;S++){let P=I+S;P=i?i[P]:P;const D=r.getX(P),F=r.getY(P),U=r.getZ(P);D<g&&(g=D),D>w&&(w=D),F<T&&(T=F),F>A&&(A=F),U<v&&(v=U),U>_&&(_=U)}}return l[o+0]!==g||l[o+1]!==T||l[o+2]!==v||l[o+3]!==w||l[o+4]!==A||l[o+5]!==_?(l[o+0]=g,l[o+1]=T,l[o+2]=v,l[o+3]=w,l[o+4]=A,l[o+5]=_,!0):!1}else{const h=o+8,y=s[o+6],g=h+m,T=y+m;let v=x,w=!1,A=!1;t?v||(w=t.has(g),A=t.has(T),v=!w&&!A):(w=!0,A=!0);const _=v||w,M=v||A;let B=!1;_&&(B=p(h,m,v));let I=!1;M&&(I=p(y,m,v));const S=B||I;if(S)for(let P=0;P<3;P++){const D=h+P,F=y+P,U=l[D],J=l[D+3],Mt=l[F],_t=l[F+3];l[o+P]=U<Mt?U:Mt,l[o+P+3]=J>_t?J:_t}return S}}}function Bs(n,t,e,i,r){E.setBuffer(n._roots[t]),Be(0,n,e,i,r),E.clearBuffer()}function Be(n,t,e,i,r){const{float32Array:a,uint16Array:s,uint32Array:c}=E,l=n*2;if(N(l,s)){const d=L(n,c),p=V(l,s);ms(t,e,i,d,p,r)}else{const d=W(n);it(d,a,i)&&Be(d,t,e,i,r);const p=H(n,c);it(p,a,i)&&Be(p,t,e,i,r)}}const Is=["x","y","z"];function Ps(n,t,e,i){E.setBuffer(n._roots[t]);const r=Ie(0,n,e,i);return E.clearBuffer(),r}function Ie(n,t,e,i){const{float32Array:r,uint16Array:a,uint32Array:s}=E;let c=n*2;if(N(c,a)){const f=L(n,s),d=V(c,a);return hs(t,e,i,f,d)}else{const f=Ee(n,s),d=Is[f],o=i.direction[d]>=0;let m,x;o?(m=W(n),x=H(n,s)):(m=H(n,s),x=W(n));const u=it(m,r,i)?Ie(m,t,e,i):null;if(u){const g=u.point[d];if(o?g<=r[x+f]:g>=r[x+f+3])return u}const y=it(x,r,i)?Ie(x,t,e,i):null;return u&&y?u.distance<=y.distance?u:y:u||y||null}}const Gt=new G,ht=new X,xt=new X,Ct=new j,Ke=new R,Yt=new R;function Cs(n,t,e,i){E.setBuffer(n._roots[t]);const r=Pe(0,n,e,i);return E.clearBuffer(),r}function Pe(n,t,e,i,r=null){const{float32Array:a,uint16Array:s,uint32Array:c}=E;let l=n*2;if(r===null&&(e.boundingBox||e.computeBoundingBox(),Ke.set(e.boundingBox.min,e.boundingBox.max,i),r=Ke),N(l,s)){const d=t.geometry,p=d.index,o=d.attributes.position,m=e.index,x=e.attributes.position,b=L(n,c),u=V(l,s);if(Ct.copy(i).invert(),e.boundsTree)return z(n,a,Yt),Yt.matrix.copy(Ct),Yt.needsUpdate=!0,e.boundsTree.shapecast({intersectsBounds:y=>Yt.intersectsBox(y),intersectsTriangle:y=>{y.a.applyMatrix4(i),y.b.applyMatrix4(i),y.c.applyMatrix4(i),y.needsUpdate=!0;for(let g=b,T=u+b;g<T;g++)if(k(xt,3*t.resolveTriangleIndex(g),p,o),xt.needsUpdate=!0,y.intersectsTriangle(xt))return!0;return!1}});for(let h=b,y=u+b;h<y;h++){const g=t.resolveTriangleIndex(h);k(ht,3*g,p,o),ht.a.applyMatrix4(Ct),ht.b.applyMatrix4(Ct),ht.c.applyMatrix4(Ct),ht.needsUpdate=!0;for(let T=0,v=m.count;T<v;T+=3)if(k(xt,T,m,x),xt.needsUpdate=!0,ht.intersectsTriangle(xt))return!0}}else{const d=n+8,p=c[n+6];return z(d,a,Gt),!!(r.intersectsBox(Gt)&&Pe(d,t,e,i,r)||(z(p,a,Gt),r.intersectsBox(Gt)&&Pe(p,t,e,i,r)))}}const Zt=new j,pe=new R,Dt=new R,Ds=new C,Fs=new C,Es=new C,zs=new C;function Us(n,t,e,i={},r={},a=0,s=1/0){t.boundingBox||t.computeBoundingBox(),pe.set(t.boundingBox.min,t.boundingBox.max,e),pe.needsUpdate=!0;const c=n.geometry,l=c.attributes.position,f=c.index,d=t.attributes.position,p=t.index,o=q.getPrimitive(),m=q.getPrimitive();let x=Ds,b=Fs,u=null,h=null;r&&(u=Es,h=zs);let y=1/0,g=null,T=null;return Zt.copy(e).invert(),Dt.matrix.copy(Zt),n.shapecast({boundsTraverseOrder:v=>pe.distanceToBox(v),intersectsBounds:(v,w,A)=>A<y&&A<s?(w&&(Dt.min.copy(v.min),Dt.max.copy(v.max),Dt.needsUpdate=!0),!0):!1,intersectsRange:(v,w)=>{if(t.boundsTree){const A=t.boundsTree;return A.shapecast({boundsTraverseOrder:_=>Dt.distanceToBox(_),intersectsBounds:(_,M,B)=>B<y&&B<s,intersectsRange:(_,M)=>{for(let B=_,I=_+M;B<I;B++){const S=A.resolveTriangleIndex(B);k(m,3*S,p,d),m.a.applyMatrix4(e),m.b.applyMatrix4(e),m.c.applyMatrix4(e),m.needsUpdate=!0;for(let P=v,D=v+w;P<D;P++){const F=n.resolveTriangleIndex(P);k(o,3*F,f,l),o.needsUpdate=!0;const U=o.distanceToTriangle(m,x,u);if(U<y&&(b.copy(x),h&&h.copy(u),y=U,g=P,T=B),U<a)return!0}}}})}else{const A=At(t);for(let _=0,M=A;_<M;_++){k(m,3*_,p,d),m.a.applyMatrix4(e),m.b.applyMatrix4(e),m.c.applyMatrix4(e),m.needsUpdate=!0;for(let B=v,I=v+w;B<I;B++){const S=n.resolveTriangleIndex(B);k(o,3*S,f,l),o.needsUpdate=!0;const P=o.distanceToTriangle(m,x,u);if(P<y&&(b.copy(x),h&&h.copy(u),y=P,g=B,T=_),P<a)return!0}}}}}),q.releasePrimitive(o),q.releasePrimitive(m),y===1/0?null:(i.point?i.point.copy(b):i.point=b.clone(),i.distance=y,i.faceIndex=g,r&&(r.point?r.point.copy(h):r.point=h.clone(),r.point.applyMatrix4(Zt),b.applyMatrix4(Zt),r.distance=b.sub(r.point).length(),r.faceIndex=T),i)}function ks(){return typeof SharedArrayBuffer<"u"}function pi(n,t){if(n===null)return n;if(n.buffer){const e=n.buffer;if(e.constructor===t)return n;const i=n.constructor,r=new i(new t(e.byteLength));return r.set(n),r}else{if(n.constructor===t)return n;const e=new t(n.byteLength);return new Uint8Array(e).set(new Uint8Array(n)),e}}const kt=new E.constructor,ne=new E.constructor,tt=new Ue(()=>new G),yt=new G,gt=new G,me=new G,he=new G;let xe=!1;function Ns(n,t,e,i){if(xe)throw new Error("MeshBVH: Recursive calls to bvhcast not supported.");xe=!0;const r=n._roots,a=t._roots;let s,c=0,l=0;const f=new j().copy(e).invert();for(let d=0,p=r.length;d<p;d++){kt.setBuffer(r[d]),l=0;const o=tt.getPrimitive();z(0,kt.float32Array,o),o.applyMatrix4(f);for(let m=0,x=a.length;m<x&&(ne.setBuffer(a[d]),s=$(0,0,e,f,i,c,l,0,0,o),ne.clearBuffer(),l+=a[m].length,!s);m++);if(tt.releasePrimitive(o),kt.clearBuffer(),c+=r[d].length,s)break}return xe=!1,s}function $(n,t,e,i,r,a=0,s=0,c=0,l=0,f=null,d=!1){let p,o;d?(p=ne,o=kt):(p=kt,o=ne);const m=p.float32Array,x=p.uint32Array,b=p.uint16Array,u=o.float32Array,h=o.uint32Array,y=o.uint16Array,g=n*2,T=t*2,v=N(g,b),w=N(T,y);let A=!1;if(w&&v)d?A=r(L(t,h),V(t*2,y),L(n,x),V(n*2,b),l,s+t,c,a+n):A=r(L(n,x),V(n*2,b),L(t,h),V(t*2,y),c,a+n,l,s+t);else if(w){const _=tt.getPrimitive();z(t,u,_),_.applyMatrix4(e);const M=W(n),B=H(n,x);z(M,m,yt),z(B,m,gt);const I=_.intersectsBox(yt),S=_.intersectsBox(gt);A=I&&$(t,M,i,e,r,s,a,l,c+1,_,!d)||S&&$(t,B,i,e,r,s,a,l,c+1,_,!d),tt.releasePrimitive(_)}else{const _=W(t),M=H(t,h);z(_,u,me),z(M,u,he);const B=f.intersectsBox(me),I=f.intersectsBox(he);if(B&&I)A=$(n,_,e,i,r,a,s,c,l+1,f,d)||$(n,M,e,i,r,a,s,c,l+1,f,d);else if(B)if(v)A=$(n,_,e,i,r,a,s,c,l+1,f,d);else{const S=tt.getPrimitive();S.copy(me).applyMatrix4(e);const P=W(n),D=H(n,x);z(P,m,yt),z(D,m,gt);const F=S.intersectsBox(yt),U=S.intersectsBox(gt);A=F&&$(_,P,i,e,r,s,a,l,c+1,S,!d)||U&&$(_,D,i,e,r,s,a,l,c+1,S,!d),tt.releasePrimitive(S)}else if(I)if(v)A=$(n,M,e,i,r,a,s,c,l+1,f,d);else{const S=tt.getPrimitive();S.copy(he).applyMatrix4(e);const P=W(n),D=H(n,x);z(P,m,yt),z(D,m,gt);const F=S.intersectsBox(yt),U=S.intersectsBox(gt);A=F&&$(M,P,i,e,r,s,a,l,c+1,S,!d)||U&&$(M,D,i,e,r,s,a,l,c+1,S,!d),tt.releasePrimitive(S)}}return A}const Kt=new R,Je=new G,Rs={strategy:mn,maxDepth:40,maxLeafTris:10,useSharedArrayBuffer:!1,setBoundingBox:!0,onProgress:null,indirect:!1,verbose:!0};class ke{static serialize(t,e={}){e={cloneBuffers:!0,...e};const i=t.geometry,r=t._roots,a=t._indirectBuffer,s=i.getIndex();let c;return e.cloneBuffers?c={roots:r.map(l=>l.slice()),index:s?s.array.slice():null,indirectBuffer:a?a.slice():null}:c={roots:r,index:s?s.array:null,indirectBuffer:a},c}static deserialize(t,e,i={}){i={setIndex:!0,indirect:!!t.indirectBuffer,...i};const{index:r,roots:a,indirectBuffer:s}=t,c=new ke(e,{...i,[ae]:!0});if(c._roots=a,c._indirectBuffer=s||null,i.setIndex){const l=e.getIndex();if(l===null){const f=new O(t.index,1,!1);e.setIndex(f)}else l.array!==r&&(l.array.set(r),l.needsUpdate=!0)}return c}get indirect(){return!!this._indirectBuffer}constructor(t,e={}){if(t.isBufferGeometry){if(t.index&&t.index.isInterleavedBufferAttribute)throw new Error("MeshBVH: InterleavedBufferAttribute is not supported for the index attribute.")}else throw new Error("MeshBVH: Only BufferGeometries are supported.");if(e=Object.assign({...Rs,[ae]:!1},e),e.useSharedArrayBuffer&&!ks())throw new Error("MeshBVH: SharedArrayBuffer is not available.");this.geometry=t,this._roots=null,this._indirectBuffer=null,e[ae]||(ts(this,e),!t.boundingBox&&e.setBoundingBox&&(t.boundingBox=this.getBoundingBox(new G)));const{_indirectBuffer:i}=this;this.resolveTriangleIndex=e.indirect?r=>i[r]:r=>r}refit(t=null){return(this.indirect?Ss:ps)(this,t)}traverse(t,e=0){const i=this._roots[e],r=new Uint32Array(i),a=new Uint16Array(i);s(0);function s(c,l=0){const f=c*2,d=a[f+15]===se;if(d){const p=r[c+6],o=a[f+14];t(l,d,new Float32Array(i,c*4,6),p,o)}else{const p=c+st/4,o=r[c+6],m=r[c+7];t(l,d,new Float32Array(i,c*4,6),m)||(s(p,l+1),s(o,l+1))}}}raycast(t,e=be){const i=this._roots,r=this.geometry,a=[],s=e.isMaterial,c=Array.isArray(e),l=r.groups,f=s?e.side:e,d=this.indirect?Bs:ys;for(let p=0,o=i.length;p<o;p++){const m=c?e[l[p].materialIndex].side:f,x=a.length;if(d(this,p,m,t,a),c){const b=l[p].materialIndex;for(let u=x,h=a.length;u<h;u++)a[u].face.materialIndex=b}}return a}raycastFirst(t,e=be){const i=this._roots,r=this.geometry,a=e.isMaterial,s=Array.isArray(e);let c=null;const l=r.groups,f=a?e.side:e,d=this.indirect?Ps:bs;for(let p=0,o=i.length;p<o;p++){const m=s?e[l[p].materialIndex].side:f,x=d(this,p,m,t);x!=null&&(c==null||x.distance<c.distance)&&(c=x,s&&(x.face.materialIndex=l[p].materialIndex))}return c}intersectsGeometry(t,e){let i=!1;const r=this._roots,a=this.indirect?Cs:vs;for(let s=0,c=r.length;s<c&&(i=a(this,s,t,e),!i);s++);return i}shapecast(t){const e=q.getPrimitive(),i=this.indirect?xs:ds;let{boundsTraverseOrder:r,intersectsBounds:a,intersectsRange:s,intersectsTriangle:c}=t;if(s&&c){const p=s;s=(o,m,x,b,u)=>p(o,m,x,b,u)?!0:i(o,m,this,c,x,b,e)}else s||(c?s=(p,o,m,x)=>i(p,o,this,c,m,x,e):s=(p,o,m)=>m);let l=!1,f=0;const d=this._roots;for(let p=0,o=d.length;p<o;p++){const m=d[p];if(l=os(this,p,a,s,r,f),l)break;f+=m.byteLength}return q.releasePrimitive(e),l}bvhcast(t,e,i){let{intersectsRanges:r,intersectsTriangles:a}=i;const s=q.getPrimitive(),c=this.geometry.index,l=this.geometry.attributes.position,f=this.indirect?x=>{const b=this.resolveTriangleIndex(x);k(s,b*3,c,l)}:x=>{k(s,x*3,c,l)},d=q.getPrimitive(),p=t.geometry.index,o=t.geometry.attributes.position,m=t.indirect?x=>{const b=t.resolveTriangleIndex(x);k(d,b*3,p,o)}:x=>{k(d,x*3,p,o)};if(a){const x=(b,u,h,y,g,T,v,w)=>{for(let A=h,_=h+y;A<_;A++){m(A),d.a.applyMatrix4(e),d.b.applyMatrix4(e),d.c.applyMatrix4(e),d.needsUpdate=!0;for(let M=b,B=b+u;M<B;M++)if(f(M),s.needsUpdate=!0,a(s,d,M,A,g,T,v,w))return!0}return!1};if(r){const b=r;r=function(u,h,y,g,T,v,w,A){return b(u,h,y,g,T,v,w,A)?!0:x(u,h,y,g,T,v,w,A)}}else r=x}return Ns(this,t,e,r)}intersectsBox(t,e){return Kt.set(t.min,t.max,e),Kt.needsUpdate=!0,this.shapecast({intersectsBounds:i=>Kt.intersectsBox(i),intersectsTriangle:i=>Kt.intersectsTriangle(i)})}intersectsSphere(t){return this.shapecast({intersectsBounds:e=>t.intersectsBox(e),intersectsTriangle:e=>e.intersectsSphere(t)})}closestPointToGeometry(t,e,i={},r={},a=0,s=1/0){return(this.indirect?Us:_s)(this,t,e,i,r,a,s)}closestPointToPoint(t,e={},i=0,r=1/0){return as(this,t,e,i,r)}getBoundingBox(t){return t.makeEmpty(),this._roots.forEach(i=>{z(0,new Float32Array(i),Je),t.union(Je)}),t}}function Ls(n){switch(n){case 1:return"R";case 2:return"RG";case 3:return"RGBA";case 4:return"RGBA"}throw new Error}function Vs(n){switch(n){case 1:return zn;case 2:return En;case 3:return Nt;case 4:return Nt}}function Qe(n){switch(n){case 1:return Fn;case 2:return pn;case 3:return ve;case 4:return ve}}class wn extends ee{constructor(){super(),this.minFilter=et,this.magFilter=et,this.generateMipmaps=!1,this.overrideItemSize=null,this._forcedType=null}updateFrom(t){const e=this.overrideItemSize,i=t.itemSize,r=t.count;if(e!==null){if(i*r%e!==0)throw new Error("VertexAttributeTexture: overrideItemSize must divide evenly into buffer length.");t.itemSize=e,t.count=r*i/e}const a=t.itemSize,s=t.count,c=t.normalized,l=t.array.constructor,f=l.BYTES_PER_ELEMENT;let d=this._forcedType,p=a;if(d===null)switch(l){case Float32Array:d=Tt;break;case Uint8Array:case Uint16Array:case Uint32Array:d=Ut;break;case Int8Array:case Int16Array:case Int32Array:d=re;break}let o,m,x,b,u=Ls(a);switch(d){case Tt:x=1,m=Vs(a),c&&f===1?(b=l,u+="8",l===Uint8Array?o=Le:(o=Ve,u+="_SNORM")):(b=Float32Array,u+="32F",o=Tt);break;case re:u+=f*8+"I",x=c?Math.pow(2,l.BYTES_PER_ELEMENT*8-1):1,m=Qe(a),f===1?(b=Int8Array,o=Ve):f===2?(b=Int16Array,o=Dn):(b=Int32Array,o=re);break;case Ut:u+=f*8+"UI",x=c?Math.pow(2,l.BYTES_PER_ELEMENT*8-1):1,m=Qe(a),f===1?(b=Uint8Array,o=Le):f===2?(b=Uint16Array,o=Cn):(b=Uint32Array,o=Ut);break}p===3&&(m===Nt||m===ve)&&(p=4);const h=Math.ceil(Math.sqrt(s))||1,y=p*h*h,g=new b(y),T=t.normalized;t.normalized=!1;for(let v=0;v<s;v++){const w=p*v;g[w]=t.getX(v)/x,a>=2&&(g[w+1]=t.getY(v)/x),a>=3&&(g[w+2]=t.getZ(v)/x,p===4&&(g[w+3]=1)),a>=4&&(g[w+3]=t.getW(v)/x)}t.normalized=T,this.internalFormat=u,this.format=m,this.type=o,this.image.width=h,this.image.height=h,this.image.data=g,this.needsUpdate=!0,this.dispose(),t.itemSize=i,t.count=r}}class Hs extends wn{constructor(){super(),this._forcedType=Ut}}class Os extends wn{constructor(){super(),this._forcedType=Tt}}class mi{constructor(){this.index=new Hs,this.position=new Os,this.bvhBounds=new ee,this.bvhContents=new ee,this._cachedIndexAttr=null,this.index.overrideItemSize=3}updateFrom(t){const{geometry:e}=t;if(qs(t,this.bvhBounds,this.bvhContents),this.position.updateFrom(e.attributes.position),t.indirect){const i=t._indirectBuffer;if(this._cachedIndexAttr===null||this._cachedIndexAttr.count!==i.length)if(e.index)this._cachedIndexAttr=e.index.clone();else{const r=yn(xn(e));this._cachedIndexAttr=new O(r,1,!1)}Ws(e,i,this._cachedIndexAttr),this.index.updateFrom(this._cachedIndexAttr)}else this.index.updateFrom(e.index)}dispose(){const{index:t,position:e,bvhBounds:i,bvhContents:r}=this;t&&t.dispose(),e&&e.dispose(),i&&i.dispose(),r&&r.dispose()}}function Ws(n,t,e){const i=e.array,r=n.index?n.index.array:null;for(let a=0,s=t.length;a<s;a++){const c=3*a,l=3*t[a];for(let f=0;f<3;f++)i[c+f]=r?r[l+f]:l+f}}function qs(n,t,e){const i=n._roots;if(i.length!==1)throw new Error("MeshBVHUniformStruct: Multi-root BVHs not supported.");const r=i[0],a=new Uint16Array(r),s=new Uint32Array(r),c=new Float32Array(r),l=r.byteLength/st,f=2*Math.ceil(Math.sqrt(l/2)),d=new Float32Array(4*f*f),p=Math.ceil(Math.sqrt(l)),o=new Uint32Array(2*p*p);for(let m=0;m<l;m++){const x=m*st/4,b=x*2,u=x;for(let h=0;h<3;h++)d[8*m+0+h]=c[u+0+h],d[8*m+4+h]=c[u+3+h];if(N(b,a)){const h=V(b,a),y=L(x,s),g=4294901760|h;o[m*2+0]=g,o[m*2+1]=y}else{const h=4*H(x,s)/st,y=Ee(x,s);o[m*2+0]=y,o[m*2+1]=h}}t.image.data=d,t.image.width=f,t.image.height=f,t.format=Nt,t.type=Tt,t.internalFormat="RGBA32F",t.minFilter=et,t.magFilter=et,t.generateMipmaps=!1,t.needsUpdate=!0,t.dispose(),e.image.data=o,e.image.width=p,e.image.height=p,e.format=pn,e.type=Ut,e.internalFormat="RG32UI",e.minFilter=et,e.magFilter=et,e.generateMipmaps=!1,e.needsUpdate=!0,e.dispose()}const hi=`

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
`,xi=`

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
`,yi=`
struct BVH {

	usampler2D index;
	sampler2D position;

	sampler2D bvhBounds;
	usampler2D bvhContents;

};
`;function An(n,t,e=0){if(n.isInterleavedBufferAttribute){const i=n.itemSize;for(let r=0,a=n.count;r<a;r++){const s=r+e;t.setX(s,n.getX(r)),i>=2&&t.setY(s,n.getY(r)),i>=3&&t.setZ(s,n.getZ(r)),i>=4&&t.setW(s,n.getW(r))}}else{const i=t.array,r=i.constructor,a=i.BYTES_PER_ELEMENT*n.itemSize*e;new r(i.buffer,a,n.array.length).set(n.array)}}function zt(n,t=null){const e=n.array.constructor,i=n.normalized,r=n.itemSize,a=t===null?n.count:t;return new O(new e(r*a),r,i)}function bt(n,t){if(!n&&!t)return!0;if(!!n!=!!t)return!1;const e=n.count===t.count,i=n.normalized===t.normalized,r=n.array.constructor===t.array.constructor,a=n.itemSize===t.itemSize;return!(!e||!i||!r||!a)}function $s(n){const t=n[0].index!==null,e=new Set(Object.keys(n[0].attributes));if(!n[0].getAttribute("position"))throw new Error("StaticGeometryGenerator: position attribute is required.");for(let i=0;i<n.length;++i){const r=n[i];let a=0;if(t!==(r.index!==null))throw new Error("StaticGeometryGenerator: All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them.");for(const s in r.attributes){if(!e.has(s))throw new Error('StaticGeometryGenerator: All geometries must have compatible attributes; make sure "'+s+'" attribute exists among all geometries, or in none of them.');a++}if(a!==e.size)throw new Error("StaticGeometryGenerator: All geometries must have the same number of attributes.")}}function Xs(n){let t=0;for(let e=0,i=n.length;e<i;e++)t+=n[e].getIndex().count;return t}function js(n){let t=0;for(let e=0,i=n.length;e<i;e++)t+=n[e].getAttribute("position").count;return t}function Gs(n,t,e){n.index&&n.index.count!==t&&n.setIndex(null);const i=n.attributes;for(const r in i)i[r].count!==e&&n.deleteAttribute(r)}function Ys(n,t={},e=new ct){const{useGroups:i=!1,forceUpdate:r=!1,skipAssigningAttributes:a=[],overwriteIndex:s=!0}=t;$s(n);const c=n[0].index!==null,l=c?Xs(n):-1,f=js(n);if(Gs(e,l,f),i){let p=0;for(let o=0,m=n.length;o<m;o++){const x=n[o];let b;c?b=x.getIndex().count:b=x.getAttribute("position").count,e.addGroup(p,b,o),p+=b}}if(c){let p=!1;if(e.index||(e.setIndex(new O(new Uint32Array(l),1,!1)),p=!0),p||s){let o=0,m=0;const x=e.getIndex();for(let b=0,u=n.length;b<u;b++){const h=n[b],y=h.getIndex();if(!(!r&&!p&&a[b]))for(let T=0;T<y.count;++T)x.setX(o+T,y.getX(T)+m);o+=y.count,m+=h.getAttribute("position").count}}}const d=Object.keys(n[0].attributes);for(let p=0,o=d.length;p<o;p++){let m=!1;const x=d[p];if(!e.getAttribute(x)){const h=n[0].getAttribute(x);e.setAttribute(x,zt(h,f)),m=!0}let b=0;const u=e.getAttribute(x);for(let h=0,y=n.length;h<y;h++){const g=n[h],T=!r&&!m&&a[h],v=g.getAttribute(x);if(!T)if(x==="color"&&u.itemSize!==v.itemSize)for(let w=b,A=v.count;w<A;w++)v.setXYZW(w,u.getX(w),u.getY(w),u.getZ(w),1);else An(v,u,b);b+=v.count}}}function Zs(n,t,e){const i=n.index,a=n.attributes.position.count,s=i?i.count:a;let c=n.groups;c.length===0&&(c=[{count:s,start:0,materialIndex:0}]);let l=n.getAttribute("materialIndex");if(!l||l.count!==a){let d;e.length<=255?d=new Uint8Array(a):d=new Uint16Array(a),l=new O(d,1,!1),n.deleteAttribute("materialIndex"),n.setAttribute("materialIndex",l)}const f=l.array;for(let d=0;d<c.length;d++){const p=c[d],o=p.start,m=p.count,x=Math.min(m,s-o),b=Array.isArray(t)?t[p.materialIndex]:t,u=e.indexOf(b);for(let h=0;h<x;h++){let y=o+h;i&&(y=i.getX(y)),f[y]=u}}}function Ks(n,t){if(!n.index){const e=n.attributes.position.count,i=new Array(e);for(let r=0;r<e;r++)i[r]=r;n.setIndex(i)}if(!n.attributes.normal&&t&&t.includes("normal")&&n.computeVertexNormals(),!n.attributes.uv&&t&&t.includes("uv")){const e=n.attributes.position.count;n.setAttribute("uv",new O(new Float32Array(e*2),2,!1))}if(!n.attributes.uv2&&t&&t.includes("uv2")){const e=n.attributes.position.count;n.setAttribute("uv2",new O(new Float32Array(e*2),2,!1))}if(!n.attributes.tangent&&t&&t.includes("tangent"))if(n.attributes.uv&&n.attributes.normal)n.computeTangents();else{const e=n.attributes.position.count;n.setAttribute("tangent",new O(new Float32Array(e*4),4,!1))}if(!n.attributes.color&&t&&t.includes("color")){const e=n.attributes.position.count,i=new Float32Array(e*4);i.fill(1),n.setAttribute("color",new O(i,4))}}function Mn(n){let t=0;if(n.byteLength!==0){const e=new Uint8Array(n);for(let i=0;i<n.byteLength;i++){const r=e[i];t=(t<<5)-t+r,t|=0}}return t}function tn(n){let t=n.uuid;const e=Object.values(n.attributes);n.index&&(e.push(n.index),t+=`index|${n.index.version}`);const i=Object.keys(e).sort();for(const r of i){const a=e[r];t+=`${r}_${a.version}|`}return t}function en(n){const t=n.skeleton;return t?(t.boneTexture||t.computeBoneTexture(),`${Mn(t.boneTexture.image.data.buffer)}_${t.boneTexture.uuid}`):null}class Js{constructor(t=null){this.matrixWorld=new j,this.geometryHash=null,this.skeletonHash=null,this.primitiveCount=-1,t!==null&&this.updateFrom(t)}updateFrom(t){const e=t.geometry,i=(e.index?e.index.count:e.attributes.position.count)/3;this.matrixWorld.copy(t.matrixWorld),this.geometryHash=tn(e),this.primitiveCount=i,this.skeletonHash=en(t)}didChange(t){const e=t.geometry,i=(e.index?e.index.count:e.attributes.position.count)/3;return!(this.matrixWorld.equals(t.matrixWorld)&&this.geometryHash===tn(e)&&this.skeletonHash===en(t)&&this.primitiveCount===i)}}const rt=new C,ot=new C,at=new C,nn=new Fe,Jt=new C,ye=new C,sn=new Fe,rn=new Fe,Qt=new j,on=new j;function an(n,t,e){const i=n.skeleton,r=n.geometry,a=i.bones,s=i.boneInverses;sn.fromBufferAttribute(r.attributes.skinIndex,t),rn.fromBufferAttribute(r.attributes.skinWeight,t),Qt.elements.fill(0);for(let c=0;c<4;c++){const l=rn.getComponent(c);if(l!==0){const f=sn.getComponent(c);on.multiplyMatrices(a[f].matrixWorld,s[f]),Qs(Qt,on,l)}}return Qt.multiply(n.bindMatrix).premultiply(n.bindMatrixInverse),e.transformDirection(Qt),e}function ge(n,t,e,i,r){Jt.set(0,0,0);for(let a=0,s=n.length;a<s;a++){const c=t[a],l=n[a];c!==0&&(ye.fromBufferAttribute(l,i),e?Jt.addScaledVector(ye,c):Jt.addScaledVector(ye.sub(r),c))}r.add(Jt)}function Qs(n,t,e){const i=n.elements,r=t.elements;for(let a=0,s=r.length;a<s;a++)i[a]+=r[a]*e}function ti(n){const{index:t,attributes:e}=n;if(t)for(let i=0,r=t.count;i<r;i+=3){const a=t.getX(i),s=t.getX(i+2);t.setX(i,s),t.setX(i+2,a)}else for(const i in e){const r=e[i],a=r.itemSize;for(let s=0,c=r.count;s<c;s+=3)for(let l=0;l<a;l++){const f=r.getComponent(s,l),d=r.getComponent(s+2,l);r.setComponent(s,l,d),r.setComponent(s+2,l,f)}}return n}function ei(n,t={},e=new ct){t={applyWorldTransforms:!0,attributes:[],...t};const i=n.geometry,r=t.applyWorldTransforms,a=t.attributes.includes("normal"),s=t.attributes.includes("tangent"),c=i.attributes,l=e.attributes;for(const y in e.attributes)(!t.attributes.includes(y)||!(y in i.attributes))&&e.deleteAttribute(y);!e.index&&i.index&&(e.index=i.index.clone()),l.position||e.setAttribute("position",zt(c.position)),a&&!l.normal&&c.normal&&e.setAttribute("normal",zt(c.normal)),s&&!l.tangent&&c.tangent&&e.setAttribute("tangent",zt(c.tangent)),bt(i.index,e.index),bt(c.position,l.position),a&&bt(c.normal,l.normal),s&&bt(c.tangent,l.tangent);const f=c.position,d=a?c.normal:null,p=s?c.tangent:null,o=i.morphAttributes.position,m=i.morphAttributes.normal,x=i.morphAttributes.tangent,b=i.morphTargetsRelative,u=n.morphTargetInfluences,h=new Un;h.getNormalMatrix(n.matrixWorld),i.index&&e.index.array.set(i.index.array);for(let y=0,g=c.position.count;y<g;y++)rt.fromBufferAttribute(f,y),d&&ot.fromBufferAttribute(d,y),p&&(nn.fromBufferAttribute(p,y),at.fromBufferAttribute(p,y)),u&&(o&&ge(o,u,b,y,rt),m&&ge(m,u,b,y,ot),x&&ge(x,u,b,y,at)),n.isSkinnedMesh&&(n.applyBoneTransform(y,rt),d&&an(n,y,ot),p&&an(n,y,at)),r&&rt.applyMatrix4(n.matrixWorld),l.position.setXYZ(y,rt.x,rt.y,rt.z),d&&(r&&ot.applyNormalMatrix(h),l.normal.setXYZ(y,ot.x,ot.y,ot.z)),p&&(r&&at.transformDirection(n.matrixWorld),l.tangent.setXYZW(y,at.x,at.y,at.z,nn.w));for(const y in t.attributes){const g=t.attributes[y];g==="position"||g==="tangent"||g==="normal"||!(g in c)||(l[g]||e.setAttribute(g,zt(c[g])),bt(c[g],l[g]),An(c[g],l[g]))}return n.matrixWorld.determinant()<0&&ti(e),e}class ni extends ct{constructor(){super(),this.version=0,this.hash=null,this._diff=new Js}isCompatible(t,e){const i=t.geometry;for(let r=0;r<e.length;r++){const a=e[r],s=i.attributes[a],c=this.attributes[a];if(s&&!bt(s,c))return!1}return!0}updateFrom(t,e){const i=this._diff;return i.didChange(t)?(ei(t,e,this),i.updateFrom(t),this.version++,this.hash=`${this.uuid}_${this.version}`,!0):!1}}const Ce=0,_n=1,Sn=2;function si(n,t){for(let e=0,i=n.length;e<i;e++)n[e].traverseVisible(a=>{a.isMesh&&t(a)})}function ii(n){const t=[];for(let e=0,i=n.length;e<i;e++){const r=n[e];Array.isArray(r.material)?t.push(...r.material):t.push(r.material)}return t}function ri(n,t,e){if(n.length===0){t.setIndex(null);const i=t.attributes;for(const r in i)t.deleteAttribute(r);for(const r in e.attributes)t.setAttribute(e.attributes[r],new O(new Float32Array(0),4,!1))}else Ys(n,e,t);for(const i in t.attributes)t.attributes[i].needsUpdate=!0}class oi{constructor(t){this.objects=null,this.useGroups=!0,this.applyWorldTransforms=!0,this.generateMissingAttributes=!0,this.overwriteIndex=!0,this.attributes=["position","normal","color","tangent","uv","uv2"],this._intermediateGeometry=new Map,this._geometryMergeSets=new WeakMap,this._mergeOrder=[],this._dummyMesh=null,this.setObjects(t||[])}_getDummyMesh(){if(!this._dummyMesh){const t=new kn,e=new ct;e.setAttribute("position",new O(new Float32Array(9),3)),this._dummyMesh=new ln(e,t)}return this._dummyMesh}_getMeshes(){const t=[];return si(this.objects,e=>{t.push(e)}),t.sort((e,i)=>e.uuid>i.uuid?1:e.uuid<i.uuid?-1:0),t.length===0&&t.push(this._getDummyMesh()),t}_updateIntermediateGeometries(){const{_intermediateGeometry:t}=this,e=this._getMeshes(),i=new Set(t.keys()),r={attributes:this.attributes,applyWorldTransforms:this.applyWorldTransforms};for(let a=0,s=e.length;a<s;a++){const c=e[a],l=c.uuid;i.delete(l);let f=t.get(l);(!f||!f.isCompatible(c,this.attributes))&&(f&&f.dispose(),f=new ni,t.set(l,f)),f.updateFrom(c,r)&&this.generateMissingAttributes&&Ks(f,this.attributes)}i.forEach(a=>{t.delete(a)})}setObjects(t){Array.isArray(t)?this.objects=[...t]:this.objects=[t]}generate(t=new ct){const{useGroups:e,overwriteIndex:i,_intermediateGeometry:r,_geometryMergeSets:a}=this,s=this._getMeshes(),c=[],l=[],f=a.get(t)||[];this._updateIntermediateGeometries();let d=!1;s.length!==f.length&&(d=!0);for(let o=0,m=s.length;o<m;o++){const x=s[o],b=r.get(x.uuid);l.push(b);const u=f[o];!u||u.uuid!==b.uuid?(c.push(!1),d=!0):u.version!==b.version?c.push(!1):c.push(!0)}ri(l,t,{useGroups:e,forceUpdate:d,skipAssigningAttributes:c,overwriteIndex:i}),d&&t.dispose(),a.set(t,l.map(o=>({version:o.version,uuid:o.uuid})));let p=Ce;return d?p=Sn:c.includes(!1)&&(p=_n),{changeType:p,materials:ii(s),geometry:t}}}function ai(n){const t=new Set;for(let e=0,i=n.length;e<i;e++){const r=n[e];for(const a in r){const s=r[a];s&&s.isTexture&&t.add(s)}}return Array.from(t)}function ci(n){const t=[],e=new Set;for(let r=0,a=n.length;r<a;r++)n[r].traverse(s=>{s.visible&&(s.isRectAreaLight||s.isSpotLight||s.isPointLight||s.isDirectionalLight)&&(t.push(s),s.iesMap&&e.add(s.iesMap))});const i=Array.from(e).sort((r,a)=>r.uuid<a.uuid?1:r.uuid>a.uuid?-1:0);return{lights:t,iesTextures:i}}class gi{get initialized(){return!!this.bvh}constructor(t){this.bvhOptions={},this.attributes=["position","normal","tangent","color","uv","uv2"],this.generateBVH=!0,this.bvh=null,this.geometry=new ct,this.staticGeometryGenerator=new oi(t),this._bvhWorker=null,this._pendingGenerate=null,this._buildAsync=!1,this._materialUuids=null}setObjects(t){this.staticGeometryGenerator.setObjects(t)}setBVHWorker(t){this._bvhWorker=t}async generateAsync(t=null){if(!this._bvhWorker)throw new Error('PathTracingSceneGenerator: "setBVHWorker" must be called before "generateAsync" can be called.');if(this.bvh instanceof Promise)return this._pendingGenerate||(this._pendingGenerate=new Promise(async()=>(await this.bvh,this._pendingGenerate=null,this.generateAsync(t)))),this._pendingGenerate;{this._buildAsync=!0;const e=this.generate(t);return this._buildAsync=!1,e.bvh=this.bvh=await e.bvh,e}}generate(t=null){const{staticGeometryGenerator:e,geometry:i,attributes:r}=this,a=e.objects;e.attributes=r,a.forEach(o=>{o.traverse(m=>{m.isSkinnedMesh&&m.skeleton&&m.skeleton.update()})});const s=e.generate(i),c=s.materials;let l=s.changeType!==Ce||this._materialUuids===null||this._materialUuids.length!==length;if(!l){for(let o=0,m=c.length;o<m;o++)if(c[o].uuid!==this._materialUuids[o]){l=!0;break}}const f=ai(c),{lights:d,iesTextures:p}=ci(a);if(l&&(Zs(i,c,c),this._materialUuids=c.map(o=>o.uuid)),this.generateBVH){if(this.bvh instanceof Promise)throw new Error("PathTracingSceneGenerator: BVH is already building asynchronously.");if(s.changeType===Sn){const o={strategy:hn,maxLeafTris:1,indirect:!0,onProgress:t,...this.bvhOptions};this._buildAsync?this.bvh=this._bvhWorker.generate(i,o):this.bvh=new ke(i,o)}else s.changeType===_n&&this.bvh.refit()}return{bvhChanged:s.changeType!==Ce,bvh:this.bvh,needsMaterialIndexUpdate:l,lights:d,iesTextures:p,geometry:i,materials:c,textures:f,objects:a}}}function Ne(n,t){return n.uuid<t.uuid?1:n.uuid>t.uuid?-1:0}function De(n){return`${n.source.uuid}:${n.colorSpace}`}function li(n){const t=new Set,e=[];for(let i=0,r=n.length;i<r;i++){const a=n[i],s=De(a);t.has(s)||(t.add(s),e.push(a))}return e}function bi(n){const t=n.map(i=>i.iesMap||null).filter(i=>i),e=new Set(t);return Array.from(e).sort(Ne)}function vi(n){const t=new Set;for(let i=0,r=n.length;i<r;i++){const a=n[i];for(const s in a){const c=a[s];c&&c.isTexture&&t.add(c)}}const e=Array.from(t);return li(e).sort(Ne)}function Ti(n){const t=[];return n.traverse(e=>{e.visible&&(e.isRectAreaLight||e.isSpotLight||e.isPointLight||e.isDirectionalLight)&&t.push(e)}),t.sort(Ne)}const Bn=47,cn=Bn*4;class ui{constructor(){this._features={}}isUsed(t){return t in this._features}setUsed(t,e=!0){e===!1?delete this._features[t]:this._features[t]=!0}reset(){this._features={}}}class wi extends ee{constructor(){super(new Float32Array(4),1,1),this.format=Nt,this.type=Tt,this.wrapS=He,this.wrapT=He,this.minFilter=et,this.magFilter=et,this.generateMipmaps=!1,this.features=new ui}updateFrom(t,e){function i(x,b,u=-1){if(b in x&&x[b]){const h=De(x[b]);return p[h]}else return u}function r(x,b,u){return b in x?x[b]:u}function a(x,b,u,h){const y=x[b]&&x[b].isTexture?x[b]:null;if(y){y.matrixAutoUpdate&&y.updateMatrix();const g=y.matrix.elements;let T=0;u[h+T++]=g[0],u[h+T++]=g[3],u[h+T++]=g[6],T++,u[h+T++]=g[1],u[h+T++]=g[4],u[h+T++]=g[7],T++}return 8}let s=0;const c=t.length*Bn,l=Math.ceil(Math.sqrt(c))||1,{image:f,features:d}=this,p={};for(let x=0,b=e.length;x<b;x++)p[De(e[x])]=x;f.width!==l&&(this.dispose(),f.data=new Float32Array(l*l*4),f.width=l,f.height=l);const o=f.data;d.reset();for(let x=0,b=t.length;x<b;x++){const u=t[x];if(u.isFogVolumeMaterial){d.setUsed("FOG");for(let g=0;g<cn;g++)o[s+g]=0;o[s+0+0]=u.color.r,o[s+0+1]=u.color.g,o[s+0+2]=u.color.b,o[s+8+3]=r(u,"emissiveIntensity",0),o[s+12+0]=u.emissive.r,o[s+12+1]=u.emissive.g,o[s+12+2]=u.emissive.b,o[s+52+1]=u.density,o[s+52+3]=0,o[s+56+2]=4,s+=cn;continue}o[s++]=u.color.r,o[s++]=u.color.g,o[s++]=u.color.b,o[s++]=i(u,"map"),o[s++]=r(u,"metalness",0),o[s++]=i(u,"metalnessMap"),o[s++]=r(u,"roughness",0),o[s++]=i(u,"roughnessMap"),o[s++]=r(u,"ior",1.5),o[s++]=r(u,"transmission",0),o[s++]=i(u,"transmissionMap"),o[s++]=r(u,"emissiveIntensity",0),"emissive"in u?(o[s++]=u.emissive.r,o[s++]=u.emissive.g,o[s++]=u.emissive.b):(o[s++]=0,o[s++]=0,o[s++]=0),o[s++]=i(u,"emissiveMap"),o[s++]=i(u,"normalMap"),"normalScale"in u?(o[s++]=u.normalScale.x,o[s++]=u.normalScale.y):(o[s++]=1,o[s++]=1),o[s++]=r(u,"clearcoat",0),o[s++]=i(u,"clearcoatMap"),o[s++]=r(u,"clearcoatRoughness",0),o[s++]=i(u,"clearcoatRoughnessMap"),o[s++]=i(u,"clearcoatNormalMap"),"clearcoatNormalScale"in u?(o[s++]=u.clearcoatNormalScale.x,o[s++]=u.clearcoatNormalScale.y):(o[s++]=1,o[s++]=1),s++,o[s++]=r(u,"sheen",0),"sheenColor"in u?(o[s++]=u.sheenColor.r,o[s++]=u.sheenColor.g,o[s++]=u.sheenColor.b):(o[s++]=0,o[s++]=0,o[s++]=0),o[s++]=i(u,"sheenColorMap"),o[s++]=r(u,"sheenRoughness",0),o[s++]=i(u,"sheenRoughnessMap"),o[s++]=i(u,"iridescenceMap"),o[s++]=i(u,"iridescenceThicknessMap"),o[s++]=r(u,"iridescence",0),o[s++]=r(u,"iridescenceIOR",1.3);const h=r(u,"iridescenceThicknessRange",[100,400]);o[s++]=h[0],o[s++]=h[1],"specularColor"in u?(o[s++]=u.specularColor.r,o[s++]=u.specularColor.g,o[s++]=u.specularColor.b):(o[s++]=1,o[s++]=1,o[s++]=1),o[s++]=i(u,"specularColorMap"),o[s++]=r(u,"specularIntensity",1),o[s++]=i(u,"specularIntensityMap");const y=r(u,"thickness",0)===0&&r(u,"attenuationDistance",1/0)===1/0;if(o[s++]=Number(y),s++,"attenuationColor"in u?(o[s++]=u.attenuationColor.r,o[s++]=u.attenuationColor.g,o[s++]=u.attenuationColor.b):(o[s++]=1,o[s++]=1,o[s++]=1),o[s++]=r(u,"attenuationDistance",1/0),o[s++]=i(u,"alphaMap"),o[s++]=u.opacity,o[s++]=u.alphaTest,!y&&u.transmission>0)o[s++]=0;else switch(u.side){case be:o[s++]=1;break;case fn:o[s++]=-1;break;case dn:o[s++]=0;break}o[s++]=Number(r(u,"matte",!1)),o[s++]=Number(r(u,"castShadow",!0)),o[s++]=Number(u.vertexColors)|Number(u.flatShading)<<1,o[s++]=Number(u.transparent),s+=a(u,"map",o,s),s+=a(u,"metalnessMap",o,s),s+=a(u,"roughnessMap",o,s),s+=a(u,"transmissionMap",o,s),s+=a(u,"emissiveMap",o,s),s+=a(u,"normalMap",o,s),s+=a(u,"clearcoatMap",o,s),s+=a(u,"clearcoatNormalMap",o,s),s+=a(u,"clearcoatRoughnessMap",o,s),s+=a(u,"sheenColorMap",o,s),s+=a(u,"sheenRoughnessMap",o,s),s+=a(u,"iridescenceMap",o,s),s+=a(u,"iridescenceThicknessMap",o,s),s+=a(u,"specularColorMap",o,s),s+=a(u,"specularIntensityMap",o,s),s+=a(u,"alphaMap",o,s)}const m=Mn(o.buffer);return this.hash!==m?(this.hash=m,this.needsUpdate=!0,!0):!1}}const Ai=`

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

`,Mi=`

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


`,_i=`

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
`;export{di as F,ke as M,gi as P,Hs as U,hi as a,yi as b,pi as c,xi as d,On as e,mi as f,Bn as g,vi as h,ks as i,Ti as j,bi as k,Mn as l,Ai as m,Os as n,wi as o,_i as p,Mi as s};
