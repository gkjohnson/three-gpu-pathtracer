import { ShaderMaterial, Matrix4, DataTexture2DArray } from 'three';
import {
	MeshBVHUniformStruct, FloatVertexAttributeTexture, UIntVertexAttributeTexture,
	shaderStructs, shaderIntersectFunction,
} from 'three-mesh-bvh';
import { shaderMaterialStructs } from '../gpu/shaderStructs.js';
import { MaterialStructArrayUniform } from '../gpu/MaterialStructArrayUniform.js';
import { RenderTarget2DArray } from '../gpu/RenderTarget2DArray.js';

export class LambertPathTracingMaterial extends ShaderMaterial {

	constructor( parameters ) {

		super( {

			defines: {
				BOUNCES: 3,
				MATERIAL_LENGTH: 0,
			},

			uniforms: {
				bvh: { value: new MeshBVHUniformStruct() },
				normalAttribute: { value: new FloatVertexAttributeTexture() },
				uvAttribute: { value: new FloatVertexAttributeTexture() },
				materialIndexAttribute: { value: new UIntVertexAttributeTexture() },
				materials: { value: new MaterialStructArrayUniform() },
				textures: { value: new RenderTarget2DArray().texture },
				cameraWorldMatrix: { value: new Matrix4() },
				invProjectionMatrix: { value: new Matrix4() },
				seed: { value: 0 },
				opacity: { value: 1 },
			},

			vertexShader: /* glsl */`

                varying vec2 vUv;
                void main() {

                    vec4 mvPosition = vec4( position, 1.0 );
                    mvPosition = modelViewMatrix * mvPosition;
                    gl_Position = projectionMatrix * mvPosition;

                    vUv = uv;

                }

            `,

			fragmentShader: /* glsl */`
                #define RAY_OFFSET 1e-5

                precision highp usampler2D;
                precision highp sampler2DArray;
                ${ shaderStructs }
                ${ shaderIntersectFunction }
				${ shaderMaterialStructs }
                #include <common>

                uniform mat4 cameraWorldMatrix;
                uniform mat4 invProjectionMatrix;
                uniform sampler2D normalAttribute;
                uniform sampler2D uvAttribute;
				uniform usampler2D materialIndexAttribute;
                uniform BVH bvh;
                uniform float seed;
                uniform float opacity;
				uniform Material materials[ MATERIAL_LENGTH ];
				uniform sampler2DArray textures;
                varying vec2 vUv;

                void main() {

                    // get [-1, 1] normalized device coordinates
                    vec2 ndc = 2.0 * vUv - vec2( 1.0 );
                    vec3 rayOrigin, rayDirection;
                    ndcToCameraRay( ndc, cameraWorldMatrix, invProjectionMatrix, rayOrigin, rayDirection );

                    // Lambertian render
                    gl_FragColor = vec4( 0.0 );

                    vec3 throughputColor = vec3( 1.0 );
                    vec3 randomPoint = vec3( .0 );

                    // hit results
                    uvec4 faceIndices = uvec4( 0u );
                    vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
                    vec3 barycoord = vec3( 0.0 );
                    float side = 1.0;
                    float dist = 0.0;
					int i;
                    for ( i = 0; i < BOUNCES; i ++ ) {

                        if ( ! bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist ) ) {

                            float value = ( rayDirection.y + 0.5 ) / 1.5;
                            vec3 skyColor = mix( vec3( 1.0 ), vec3( 0.75, 0.85, 1.0 ), value );

                            gl_FragColor = vec4( skyColor * throughputColor * 2.0, 1.0 );

                            break;

                        }


                        randomPoint = vec3(
                            rand( vUv + float( i + 1 ) + vec2( seed, seed ) ),
                            rand( - vUv * seed + float( i ) - seed ),
                            rand( - vUv * float( i + 1 ) - vec2( seed, - seed ) )
                        );
                        randomPoint -= 0.5;
                        randomPoint *= 2.0;

                        // ensure the random vector is not 0,0,0 and that it won't exactly negate
                        // the surface normal

                        float pointLength = max( length( randomPoint ), 1e-4 );
                        randomPoint /= pointLength;
                        randomPoint *= 0.999;

                        // fetch the interpolated smooth normal
                        vec3 normal =
                            side *
                            textureSampleBarycoord(
                                normalAttribute,
                                barycoord,
                                faceIndices.xyz
                            ).xyz;

						vec2 uv = textureSampleBarycoord( uvAttribute, barycoord, faceIndices.xyz ).xy;
						uint materialIndex = uTexelFetch1D( materialIndexAttribute, faceIndices.x ).r;
						Material material = materials[ materialIndex ];

                        // 1 / PI attenuation for physically correct lambert model
                        // https://www.rorydriscoll.com/2009/01/25/energy-conservation-in-games/
                        throughputColor *= 1.0 / PI;
						throughputColor *= material.color;
						if ( material.map != - 1 ) {

							throughputColor *= texture2D( textures, vec3( uv, material.map ) ).xyz;

						}

                        // adjust the hit point by the surface normal by a factor of some offset and the
                        // maximum component-wise value of the current point to accommodate floating point
                        // error as values increase.
                        vec3 point = rayOrigin + rayDirection * dist;
                        vec3 absPoint = abs( point );
                        float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
                        rayOrigin = point + faceNormal * ( maxPoint + 1.0 ) * RAY_OFFSET;
                        rayDirection = normalize( normal + randomPoint );

                    }

					// gl_FragColor.rgb = mix( gl_FragColor.rgb / 2.0, gl_FragColor.rgb, clamp( float( i ), 0.0, 1.0 ) );
                    gl_FragColor.a = opacity;

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
