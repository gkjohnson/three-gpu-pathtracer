import { ShaderMaterial } from 'three';
import {
	MeshBVHUniformStruct, shaderStructs, shaderIntersectFunction,
} from 'three-mesh-bvh';
import { shaderMaterialStructs, pathTracingHelpers } from '../shader/shaderStructs.js';

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

					// compute the flat face surface normal
					vec3 fdx = vec3( dFdx( vPos.x ), dFdx( vPos.y ), dFdx( vPos.z ) );
					vec3 fdy = vec3( dFdy( vPos.x ), dFdy( vPos.y ), dFdy( vPos.z ) );
					vec3 faceNormal = normalize( cross( fdx, fdy ) );

					// find the max component to scale the offset to account for floating point error
					vec3 absPoint = abs( vPos );
					float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );

					vec3 rayOrigin = vPos + faceNormal * ( maxPoint + 1.0 ) * RAY_OFFSET;
					float accumulated = 0.0;
					for ( int i = 0; i < SAMPLES; i ++ ) {

						// sample the cosine weighted hemisphere and discard the sample if it's below
						// the geometric surface
						vec3 rayDirection = getHemisphereSample( vNorm, rand2() );
						if ( dot( rayDirection, faceNormal ) < 0.0 ) {

							gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
							continue;

						}

						// check if we hit the mesh and its within the specified radius
						float side = 1.0;
						float dist = 0.0;
						vec3 barycoord = vec3( 0.0 );
						vec3 outNormal = vec3( 0.0 );
						if (
							bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, outNormal, barycoord, side, dist ) &&
							dist < radius
						) {

							accumulated += 1.0;

						}

					}

					gl_FragColor.rgb = vec3( 1.0 - accumulated / float( SAMPLES ) );
					gl_FragColor.a = 1.0;

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
