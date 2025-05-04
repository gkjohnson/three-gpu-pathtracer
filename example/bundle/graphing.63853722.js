let e,t,o,a,i,n,r;function s(e,t,o,a){Object.defineProperty(e,t,{get:o,set:a,enumerable:!0,configurable:!0})}var l=globalThis,c={},h={},d=l.parcelRequire5b70;null==d&&((d=function(e){if(e in c)return c[e].exports;if(e in h){var t=h[e];delete h[e];var o={id:e,exports:{}};return c[e]=o,t.call(o.exports,o,o.exports),o.exports}var a=Error("Cannot find module '"+e+"'");throw a.code="MODULE_NOT_FOUND",a}).register=function(e,t){h[e]=t},l.parcelRequire5b70=d);var u=d.register;u("9fZ6X",function(e,t){s(e.exports,"MaterialBase",()=>a);var o=d("ilwiq");class a extends o.ShaderMaterial{set needsUpdate(e){super.needsUpdate=!0,this.dispatchEvent({type:"recompilation"})}constructor(e){for(let t in super(e),this.uniforms)Object.defineProperty(this,t,{get(){return this.uniforms[t].value},set(e){this.uniforms[t].value=e}})}setDefine(e,t){if(null==t){if(e in this.defines)return delete this.defines[e],this.needsUpdate=!0,!0}else if(this.defines[e]!==t)return this.defines[e]=t,this.needsUpdate=!0,!0;return!1}}}),u("8keuf",function(e,t){s(e.exports,"ggx_functions",()=>o);let o=`

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

`}),u("fYvb1",function(e,t){s(e.exports,"math_functions",()=>o);let o=`

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

`}),u("dUUQZ",function(e,t){s(e.exports,"util_functions",()=>o);let o=`

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
`});var f=d("ilwiq"),p=d("jiuw3"),f=d("ilwiq"),m=d("9fZ6X");class v extends m.MaterialBase{get graphFunctionSnippet(){return this._graphFunctionSnippet}set graphFunctionSnippet(e){this._graphFunctionSnippet=e}constructor(e){super({blending:f.NoBlending,transparent:!1,depthWrite:!1,depthTest:!1,defines:{USE_SLIDER:0},uniforms:{dim:{value:!0},thickness:{value:1},graphCount:{value:4},graphDisplay:{value:new f.Vector4(1,1,1,1)},overlay:{value:!0},xRange:{value:new f.Vector2(-2,2)},yRange:{value:new f.Vector2(-2,2)},colors:{value:[new(0,f.Color)(15277667).convertSRGBToLinear(),new(0,f.Color)(5025616).convertSRGBToLinear(),new(0,f.Color)(240116).convertSRGBToLinear(),new(0,f.Color)(16761095).convertSRGBToLinear()]}},vertexShader:`

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
		`,this.setValues(e)}onBeforeCompile(e){return e.fragmentShader=e.fragmentShader.replace("__FUNCTION_CONTENT__",this._graphFunctionSnippet),e}customProgramCacheKey(){return this._graphFunctionSnippet}}var g=d("8keuf"),x=d("fYvb1"),y=d("dUUQZ");const w=`
	#include <common>
	${x.math_functions}
	${y.util_functions}
	${g.ggx_functions}

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
`;let b=10;const T={aspect:1,displayX:!0,displayY:!0,displayZ:!0,displayW:!0,reset(){b=10,i.set(-(.5*b)+.05*b,S()*b*.5-.05*b)}};function _(){let n=a.material,r=S();n.xRange.set(-i.x-.5*b,-i.x+.5*b),n.yRange.set(i.y-.5*r*b,i.y+.5*r*b),n.graphDisplay.set(Number(T.displayX),Number(T.displayY),Number(T.displayZ),Number(T.displayW)),o.render(t,e)}function S(){return T.aspect*window.innerHeight/window.innerWidth}!async function(){r=document.getElementById("dataContainer"),n=document.getElementById("data"),(o=new f.WebGLRenderer({antialias:!0})).setSize(window.innerWidth,window.innerHeight),o.setClearColor(1119772),o.setPixelRatio(window.devicePixelRatio),o.setAnimationLoop(_),document.body.appendChild(o.domElement),(e=new f.OrthographicCamera).position.set(0,0,1.5),t=new f.Scene,i=new f.Vector2,(a=new f.Mesh(new f.PlaneGeometry,new v({side:f.DoubleSide,thickness:1,graphFunctionSnippet:w}))).scale.setScalar(2),t.add(a),i.set(-(.5*b)+.05*b,S()*b*.5-.05*b);let s=new p.default;s.add(a.material,"dim"),s.add(a.material,"thickness",.5,10),s.add(T,"aspect",.1,2),s.add(T,"reset");let l=s.addFolder("graphs");l.add(T,"displayX").name("display graph 1"),l.add(T,"displayY").name("display graph 2"),l.add(T,"displayZ").name("display graph 3"),l.add(T,"displayW").name("display graph 4");let c=!1,h=-1,d=-1;o.domElement.addEventListener("pointerleave",()=>{r.style.visibility="hidden"}),o.domElement.addEventListener("pointerenter",()=>{r.style.visibility="visible"}),o.domElement.addEventListener("pointerdown",e=>{c=!0,h=e.clientX,d=e.clientY}),o.domElement.addEventListener("pointermove",e=>{if(c=c&&!!(1&e.buttons)){let t=e.clientX-h,o=e.clientY-d;h=e.clientX,d=e.clientY;let a=S(),n=1*b*t/window.innerWidth,r=b*a*o/window.innerHeight;i.x+=n,i.y+=r}r.style.left=`${e.clientX}px`,r.style.top=`${e.clientY}px`;let t=function(e,t){let o=S(),a=e/window.innerWidth-.5,n=t/window.innerHeight-.5;return{x:1*b*a-i.x,y:-(b*o*n-i.y)}}(e.clientX,e.clientY);n.innerText=`x: ${t.x.toFixed(3)}
y: ${t.y.toFixed(3)}`}),o.domElement.addEventListener("wheel",e=>{let t=e.clientX,o=e.clientY,a=S(),n=t/window.innerWidth-.5,r=o/window.innerHeight-.5,s=1*b*n,l=b*a*r,c=b;e.deltaY<0?b*=.95:b/=.95;let h=s*(b=Math.min(b=Math.max(b,.1),100))/c,d=l*b/c;i.x-=s-h,i.y-=l-d}),window.addEventListener("resize",()=>{o.setSize(window.innerWidth,window.innerHeight)})}();
//# sourceMappingURL=graphing.63853722.js.map
