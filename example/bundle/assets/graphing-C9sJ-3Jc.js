import"./modulepreload-polyfill-B5Qt9EMX.js";import{b as E,C as f,V as _,aO as X,aP as k,at as D,a3 as L,av as N,X as B,aF as V,A}from"./MaterialBase-byhyp4gt.js";import{g as G}from"./lil-gui.module.min-BH_YJbPT.js";import{m as I,u as M,g as U}from"./ggx_functions.glsl-BPuHaSoe.js";class Z extends E{get graphFunctionSnippet(){return this._graphFunctionSnippet}set graphFunctionSnippet(n){this._graphFunctionSnippet=n}constructor(n){super({blending:k,transparent:!1,depthWrite:!1,depthTest:!1,defines:{USE_SLIDER:0},uniforms:{dim:{value:!0},thickness:{value:1},graphCount:{value:4},graphDisplay:{value:new X(1,1,1,1)},overlay:{value:!0},xRange:{value:new _(-2,2)},yRange:{value:new _(-2,2)},colors:{value:[new f(15277667).convertSRGBToLinear(),new f(5025616).convertSRGBToLinear(),new f(240116).convertSRGBToLinear(),new f(16761095).convertSRGBToLinear()]}},vertexShader:`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}

			`,fragmentShader:`
				varying vec2 vUv;
				uniform bool overlay;
				uniform bool dim;
				uniform bvec4 graphDisplay;
				uniform float graphCount;
				uniform float thickness;
				uniform vec2 xRange;
				uniform vec2 yRange;
				uniform vec3 colors[ 4 ];

				__FUNCTION_CONTENT__

				float map( float _min, float _max, float v ) {

					float len = _max - _min;
					return _min + len * v;

				}

				vec3 getBackground( vec2 point, float steepness ) {

					vec2 pw = fwidth( point );
					vec2 halfWidth = pw * 0.5;

					// x, y axes
					vec2 distToZero = smoothstep(
						- halfWidth * 0.5,
						halfWidth * 0.5,
						abs( point.xy ) - pw
					);

					// 1 unit markers
					vec2 temp;
					vec2 modAxis = abs( modf( point + vec2( 0.5 ), temp ) ) - 0.5;
					vec2 distToAxis = smoothstep(
						- halfWidth,
						halfWidth,
						abs( modAxis.xy ) - pw * 0.5
					);

					// if we're at a chart boundary then remove the artifacts
					if ( abs( pw.y ) > steepness * 0.5 ) {

						distToZero.y = 1.0;
						distToAxis.y = 1.0;

					}

					// mix colors into a background color
					float axisIntensity = 1.0 - min( distToZero.x, distToZero.y );
					float markerIntensity = 1.0 - min( distToAxis.x, distToAxis.y );

					vec3 markerColor = mix( vec3( 0.005 ), vec3( 0.05 ), markerIntensity );
					vec3 backgroundColor = mix( markerColor, vec3( 0.2 ), axisIntensity );
					return backgroundColor;

				}

				void main() {

					// from uniforms
					float sectionCount = overlay ? 1.0 : graphCount;
					float yWidth = abs( yRange.y - yRange.x );

					// separate into sections
					float _section;
					float sectionY = modf( sectionCount * vUv.y, _section );
					int section = int( sectionCount - _section - 1.0 );

					// get the current point
					vec2 point = vec2(
						map( xRange.x, xRange.y, vUv.x ),
						map( yRange.x, yRange.y, sectionY )
					);

					// get the results
					vec4 result = graphFunction( point.x );
					vec4 delta = result - vec4( point.y );
					vec4 halfDdf = fwidth( delta ) * 0.5;
					if ( fwidth( point.y ) > yWidth * 0.5 ) {

						halfDdf = vec4( 0.0 );

					}

					// graph display intensity
					vec4 graph = smoothstep( - halfDdf, halfDdf, abs( delta ) - thickness * halfDdf );

					// initialize the background
					gl_FragColor.rgb = getBackground( point, yWidth );
					gl_FragColor.a = 1.0;

					if ( dim && ( point.x < 0.0 || point.y < 0.0 ) ) {

						graph = mix(
							vec4( 1.0 ),
							graph,
							0.05
						);

					}

					// color the charts
					if ( sectionCount > 1.0 ) {

						if ( graphDisplay[ section ] ) {

							gl_FragColor.rgb = mix(
								colors[ section ],
								gl_FragColor.rgb,
								graph[ section ]
							);

						}

					} else {

						for ( int i = 0; i < int( graphCount ); i ++ ) {

							if ( graphDisplay[ i ] ) {

								gl_FragColor.rgb = mix(
									colors[ i ],
									gl_FragColor.rgb,
									graph[ i ]
								);

							}

						}

					}

					#include <colorspace_fragment>

				}

			`}),this._graphFunctionSnippet=`
			vec4 graphFunctionSnippet( float x ) {

				return vec4(
					sin( x * 3.1415926535 ),
					cos( x ),
					0.0,
					0.0
				);

			}
		`,this.setValues(n)}onBeforeCompile(n){return n.fragmentShader=n.fragmentShader.replace("__FUNCTION_CONTENT__",this._graphFunctionSnippet),n}customProgramCacheKey(){return this._graphFunctionSnippet}}const P=`
	#include <common>
	${I}
	${M}
	${U}

	vec4 graphFunction( float x ) {

		vec3 wi = normalize( vec3( 1.0, 1.0, 1.0 ) );
		vec3 halfVec = vec3( 0.0, 0.0, 1.0 );
		float theta = dot( wi, halfVec );

		return vec4(
			ggxPDF( wi, halfVec, x ),
			ggxDistribution( halfVec, x ),
			ggxShadowMaskG1( theta, x ),
			ggxLamda( theta, x )
		);

	}
`;let b,C,i,c,a,e=10,R,g;const r={aspect:1,displayX:!0,displayY:!0,displayZ:!0,displayW:!0,reset(){e=10,a.set(-e*.5+e*.05,d()*e*.5-e*.05)}};$();async function $(){g=document.getElementById("dataContainer"),R=document.getElementById("data"),i=new D({antialias:!0}),i.setSize(window.innerWidth,window.innerHeight),i.setClearColor(1119772),i.setPixelRatio(window.devicePixelRatio),i.setAnimationLoop(z),document.body.appendChild(i.domElement),b=new L,b.position.set(0,0,1.5),C=new N,a=new _,c=new B(new V,new Z({side:A,thickness:1,graphFunctionSnippet:P})),c.scale.setScalar(2),C.add(c),a.set(-e*.5+e*.05,d()*e*.5-e*.05);const o=new G;o.add(c.material,"dim"),o.add(c.material,"thickness",.5,10),o.add(r,"aspect",.1,2),o.add(r,"reset");const n=o.addFolder("graphs");n.add(r,"displayX").name("display graph 1"),n.add(r,"displayY").name("display graph 2"),n.add(r,"displayZ").name("display graph 3"),n.add(r,"displayW").name("display graph 4");let s=!1,p=-1,h=-1;i.domElement.addEventListener("pointerleave",()=>{g.style.visibility="hidden"}),i.domElement.addEventListener("pointerenter",()=>{g.style.visibility="visible"}),i.domElement.addEventListener("pointerdown",t=>{s=!0,p=t.clientX,h=t.clientY}),i.domElement.addEventListener("pointermove",t=>{if(s=s&&!!(t.buttons&1),s){const m=t.clientX-p,v=t.clientY-h;p=t.clientX,h=t.clientY;const y=1,x=d(),w=e*y*m/window.innerWidth,u=e*x*v/window.innerHeight;a.x+=w,a.y+=u}g.style.left=`${t.clientX}px`,g.style.top=`${t.clientY}px`;const l=H(t.clientX,t.clientY);R.innerText=`x: ${l.x.toFixed(3)}
y: ${l.y.toFixed(3)}`}),i.domElement.addEventListener("wheel",t=>{const l=t.clientX,m=t.clientY,v=1,y=d(),x=l/window.innerWidth-.5,w=m/window.innerHeight-.5,u=e*v*x,W=e*y*w,F=e,S=Math.pow(.95,1);t.deltaY<0?e*=S:e/=S,e=Math.max(e,.1),e=Math.min(e,100);const T=u*e/F,Y=W*e/F;a.x-=u-T,a.y-=W-Y}),window.addEventListener("resize",()=>{i.setSize(window.innerWidth,window.innerHeight)})}function z(){const o=c.material,n=1,s=d();o.xRange.set(-a.x-.5*n*e,-a.x+.5*n*e),o.yRange.set(a.y-.5*s*e,a.y+.5*s*e),o.graphDisplay.set(Number(r.displayX),Number(r.displayY),Number(r.displayZ),Number(r.displayW)),i.render(C,b)}function d(){return r.aspect*window.innerHeight/window.innerWidth}function H(o,n){const p=d(),h=o/window.innerWidth-.5,t=n/window.innerHeight-.5,l=e*1*h-a.x,m=e*p*t-a.y;return{x:l,y:-m}}
