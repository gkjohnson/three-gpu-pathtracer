import { ShaderMaterial, Matrix4, Color } from 'three';
import {
	MeshBVHUniformStruct, FloatVertexAttributeTexture, UIntVertexAttributeTexture,
	shaderStructs, shaderIntersectFunction,
} from 'three-mesh-bvh';
import { shaderMaterialStructs, pathTracingHelpers } from '../shader/shaderStructs.js';
import { MaterialStructArrayUniform } from '../uniforms/MaterialStructArrayUniform.js';
import { RenderTarget2DArray } from '../uniforms/RenderTarget2DArray.js';

export class AmbientOcclusionMaterial extends ShaderMaterial {

	constructor( parameters ) {

		super( {

			defines: {
				SAMPLES: 10,
			},

			uniforms: {
				bvh: { value: new MeshBVHUniformStruct() },
				radius: { value: 1.0 },
				seed: { value: 0 },
			},

			vertexShader: /* glsl */`

                varying vec2 vUv;
				varying vec3 vNorm;
				varying vec3 vPos;
                void main() {

                    vec4 mvPosition = vec4( position, 1.0 );
                    mvPosition = modelViewMatrix * mvPosition;
                    gl_Position = projectionMatrix * mvPosition;

                    vUv = uv;
					vNorm = normalize( normal );
					vPos = ( vec4( position, 1.0 ) ).xyz;

                }

            `,

			fragmentShader: /* glsl */`
                #define RAY_OFFSET 1e-5
				#define ENVMAP_TYPE_CUBE_UV

                precision highp isampler2D;
                precision highp usampler2D;
                precision highp sampler2DArray;
				vec4 envMapTexelToLinear( vec4 a ) { return a; }
                #include <common>
				#include <cube_uv_reflection_fragment>

                ${ shaderStructs }
                ${ shaderIntersectFunction }
				${ shaderMaterialStructs }
				${ pathTracingHelpers }

                uniform BVH bvh;
                uniform int seed;
				uniform float radius;
                varying vec2 vUv;
				varying vec3 vNorm;
				varying vec3 vPos;

                void main() {

					rng_initialize( gl_FragCoord.xy, seed );

                    // Lambertian render
                    gl_FragColor = vec4( 0.0 );

                    vec3 throughputColor = vec3( 1.0 );

                    // hit results
                    uvec4 faceIndices = uvec4( 0u );

					vec3 fdx = vec3( dFdx( vPos.x ), dFdx( vPos.y ), dFdx( vPos.z ) );
					vec3 fdy = vec3( dFdy( vPos.x ), dFdy( vPos.y ), dFdy( vPos.z ) );
					vec3 faceNormal = normalize( cross( fdx, fdy ) );

					vec3 absPoint = abs( vPos );
					float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );

					vec3 rayOrigin = vPos + faceNormal * ( maxPoint + 1.0 ) * RAY_OFFSET;
					float accumulated = 0.0;
					for ( int i = 0; i < SAMPLES; i ++ ) {

						vec3 rayDirection = getHemisphereSample( vNorm, rand2() );
						if ( dot( rayDirection, faceNormal ) < 0.0 ) {

							gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
							continue;

						}

						float side = 1.0;
						float dist = 0.0;
						vec3 barycoord, outNormal;
						if ( bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, outNormal, barycoord, side, dist ) && dist < radius ) {

							accumulated += 1.0;

						}

					}

					gl_FragColor.rgb = vec3( 1.0 - accumulated / float( SAMPLES ) );
					gl_FragColor.a = 1.0;

					return;


                    // for ( i = 0; i < BOUNCES; i ++ ) {



					// }

                    //     if ( ! bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist ) ) {

					// 		#if GRADIENT_BG

					// 		if ( i == 0 ) {

					// 			rayDirection = normalize( rayDirection );
					// 			float value = ( rayDirection.y + 1.0 ) / 2.0;

					// 			value = pow( value, 2.0 );

					// 			gl_FragColor = vec4( mix( bgGradientBottom, bgGradientTop, value ), 1.0 );
					// 			break;

					// 		}

					// 		#endif

					// 		#if USE_ENVMAP

                    //         vec3 skyColor = textureCubeUV( environmentMap, rayDirection, environmentBlur ).rgb;

					// 		#else

					// 		rayDirection = normalize( rayDirection );
					// 		float value = ( rayDirection.y + 1.0 ) / 2.0;
					// 		vec3 skyColor = mix( gradientBottom, gradientTop, value );

					// 		#endif

                    //         gl_FragColor += vec4( skyColor * throughputColor * environmentIntensity, 1.0 );

                    //         break;

					// 	}


					// 	uint materialIndex = uTexelFetch1D( materialIndexAttribute, faceIndices.x ).r;
					// 	Material material = materials[ materialIndex ];

					// 	if ( material.opacity < rand() ) {

					// 		vec3 point = rayOrigin + rayDirection * dist;
					// 		rayOrigin += rayDirection * dist - faceNormal * RAY_OFFSET;
					// 		throughputColor *= mix( vec3( 1.0 ), material.color, 0.5 * material.opacity );

					// 		i --;
					// 		continue;

					// 	}

                    //     // fetch the interpolated smooth normal
                    //     vec3 normal = normalize( textureSampleBarycoord(
					// 		normalAttribute,
					// 		barycoord,
					// 		faceIndices.xyz
					// 	).xyz );

					// 	vec2 uv = textureSampleBarycoord( uvAttribute, barycoord, faceIndices.xyz ).xy;

					// 	// emission
					// 	vec3 emission = material.emissiveIntensity * material.emissive;
					// 	if ( material.emissiveMap != - 1 ) {

					// 		emission *= texture2D( textures, vec3( uv, material.emissiveMap ) ).xyz;

					// 	}

					// 	gl_FragColor.rgb += throughputColor * emission * max( side, 0.0 );

					// 	// 1 / PI attenuation for physically correct lambert model
                    //     // https://www.rorydriscoll.com/2009/01/25/energy-conservation-in-games/
                    //     throughputColor *= 1.0 / PI;

					// 	// albedo
					// 	throughputColor *= material.color;
					// 	if ( material.map != - 1 ) {

					// 		throughputColor *= texture2D( textures, vec3( uv, material.map ) ).xyz;

					// 	}

					// 	// normal
					// 	if ( material.normalMap != - 1 ) {

					// 		vec4 tangentSample = textureSampleBarycoord(
					// 			tangentAttribute,
					// 			barycoord,
					// 			faceIndices.xyz
					// 		);

					// 		// some provided tangents can be malformed (0, 0, 0) causing the normal to be degenerate
					// 		// resulting in NaNs and slow path tracing.
					// 		if ( length( tangentSample.xyz ) > 0.0 ) {

					// 			vec3 tangent = normalize( tangentSample.xyz );
					// 			vec3 bitangent = normalize( cross( normal, tangent ) * tangentSample.w );
					// 			mat3 vTBN = mat3( tangent, bitangent, normal );

					// 			vec3 texNormal = texture2D( textures, vec3( uv, material.normalMap ) ).xyz * 2.0 - 1.0;
					// 			texNormal.xy *= material.normalScale;
					// 			normal = vTBN * texNormal;

					// 		}

					// 	}

					// 	normal *= side;

                    //     // adjust the hit point by the surface normal by a factor of some offset and the
                    //     // maximum component-wise value of the current point to accommodate floating point
                    //     // error as values increase.
                    //     vec3 point = rayOrigin + rayDirection * dist;
                    //     vec3 absPoint = abs( point );
                    //     float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
                    //     rayOrigin = point + faceNormal * ( maxPoint + 1.0 ) * RAY_OFFSET;
                    //     rayDirection = getHemisphereSample( normal, rand2() );

					// 	// if the surface normal is skewed such that the outgoing vector can wind up underneath
					// 	// the triangle surface then just consider it absorbed.
					// 	if ( dot( rayDirection, faceNormal ) < 0.0 ) {

					// 		break;

					// 	}


                    // }

					// // gl_FragColor.rgb = mix( gl_FragColor.rgb / 2.0, gl_FragColor.rgb, clamp( float( i ), 0.0, 1.0 ) );
					// // gl_FragColor.rgb = mix( textureCubeUV( environmentMap, rayDirection, 0.0 ).rgb, gl_FragColor.rgb, clamp( float( i ), 0.0, 1.0 ) );
                    // gl_FragColor.a = opacity;

                }

            `

		} );

		for ( const key in this.uniforms ) {

			Object.defineProperty( this, key, {

				get() {

					return this.uniforms[ key ].value;

				},

				set( v ) {

					this.uniforms[ key ].value = v;

				}

			} );

		}

		this.setValues( parameters );

	}

	setDefine( name, value = undefined ) {

		if ( value === undefined || value === null ) {

			if ( name in this.defines ) {

				delete this.defines[ name ];
				this.needsUpdate = true;

			}

		} else {

			if ( this.defines[ name ] !== value ) {

				this.defines[ name ] = value;
				this.needsUpdate = true;

			}

		}

	}

}
