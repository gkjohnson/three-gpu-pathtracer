import { ShaderMaterial, Matrix4, Color } from 'three';
import {
	MeshBVHUniformStruct, FloatVertexAttributeTexture, UIntVertexAttributeTexture,
	shaderStructs, shaderIntersectFunction,
} from 'three-mesh-bvh';
import { shaderMaterialStructs, pathTracingHelpers } from '../shader/shaderStructs.js';
import { MaterialStructArrayUniform } from '../uniforms/MaterialStructArrayUniform.js';
import { RenderTarget2DArray } from '../uniforms/RenderTarget2DArray.js';
import { shaderGGXFunctions } from '../shader/shaderGGXFunctions.js';
import { shaderMaterialSampling } from '../shader/shaderMaterialSampling.js';
import { shaderUtils } from '../shader/shaderUtils.js';

export class PathTracingMaterial extends ShaderMaterial {

	// three.js relies on this field to add env map functions and defines
	get envMap() {

		return this.environmentMap;

	}

	constructor( parameters ) {

		super( {

			defines: {
				BOUNCES: 3,
				TRANSPARENT_TRAVERSALS: 20,
				MATERIAL_LENGTH: 0,
				GRADIENT_BG: 0,
			},

			uniforms: {
				bvh: { value: new MeshBVHUniformStruct() },
				normalAttribute: { value: new FloatVertexAttributeTexture() },
				tangentAttribute: { value: new FloatVertexAttributeTexture() },
				uvAttribute: { value: new FloatVertexAttributeTexture() },
				materialIndexAttribute: { value: new UIntVertexAttributeTexture() },
				materials: { value: new MaterialStructArrayUniform() },
				textures: { value: new RenderTarget2DArray().texture },
				cameraWorldMatrix: { value: new Matrix4() },
				invProjectionMatrix: { value: new Matrix4() },
				environmentBlur: { value: 0.2 },
				environmentIntensity: { value: 2.0 },
				environmentMap: { value: null },
				seed: { value: 0 },
				opacity: { value: 1 },
				filterGlossyFactor: { value: 0.0 },

				gradientTop: { value: new Color( 0xbfd8ff ) },
				gradientBottom: { value: new Color( 0xffffff ) },

				bgGradientTop: { value: new Color( 0x111111 ) },
				bgGradientBottom: { value: new Color( 0x000000 ) },
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

				${ shaderUtils }
				${ shaderGGXFunctions }
				${ shaderMaterialSampling }

				#ifdef USE_ENVMAP

				uniform float environmentBlur;
                uniform sampler2D environmentMap;

				#else

                uniform vec3 gradientTop;
                uniform vec3 gradientBottom;

				#endif

				#if GRADIENT_BG

				uniform vec3 bgGradientTop;
                uniform vec3 bgGradientBottom;

				#endif

                uniform mat4 cameraWorldMatrix;
                uniform mat4 invProjectionMatrix;
                uniform sampler2D normalAttribute;
                uniform sampler2D tangentAttribute;
                uniform sampler2D uvAttribute;
				uniform usampler2D materialIndexAttribute;
                uniform BVH bvh;
                uniform float environmentIntensity;
                uniform float filterGlossyFactor;
                uniform int seed;
                uniform float opacity;
				uniform Material materials[ MATERIAL_LENGTH ];
				uniform sampler2DArray textures;
                varying vec2 vUv;

                void main() {

					rng_initialize( gl_FragCoord.xy, seed );

                    // get [-1, 1] normalized device coordinates
                    vec2 ndc = 2.0 * vUv - vec2( 1.0 );
                    vec3 rayOrigin, rayDirection;
                    ndcToCameraRay( ndc, cameraWorldMatrix, invProjectionMatrix, rayOrigin, rayDirection );

                    // Lambertian render
                    gl_FragColor = vec4( 0.0 );

                    vec3 throughputColor = vec3( 1.0 );

                    // hit results
                    uvec4 faceIndices = uvec4( 0u );
                    vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
                    vec3 barycoord = vec3( 0.0 );
                    float side = 1.0;
                    float dist = 0.0;
					float accumulatedRoughness = 0.0;
					int i;
					int transparentTraversals = TRANSPARENT_TRAVERSALS;
                    for ( i = 0; i < BOUNCES; i ++ ) {

                        if ( ! bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist ) ) {

							#if GRADIENT_BG

							if ( i == 0 ) {

								rayDirection = normalize( rayDirection );
								float value = ( rayDirection.y + 1.0 ) / 2.0;

								value = pow( value, 2.0 );

								gl_FragColor = vec4( mix( bgGradientBottom, bgGradientTop, value ), 1.0 );
								break;

							}

							#endif

							#ifdef USE_ENVMAP

                            vec3 skyColor = textureCubeUV( environmentMap, rayDirection, environmentBlur ).rgb;

							#else

							rayDirection = normalize( rayDirection );
							float value = ( rayDirection.y + 1.0 ) / 2.0;
							vec3 skyColor = mix( gradientBottom, gradientTop, value );

							#endif

                            gl_FragColor += vec4( skyColor * throughputColor * environmentIntensity, 1.0 );

                            break;

						}

						uint materialIndex = uTexelFetch1D( materialIndexAttribute, faceIndices.x ).r;
						Material material = materials[ materialIndex ];

						vec2 uv = textureSampleBarycoord( uvAttribute, barycoord, faceIndices.xyz ).xy;

						// albedo
						vec4 albedo = vec4( material.color, material.opacity );
						if ( material.map != - 1 ) {

							albedo *= texture2D( textures, vec3( uv, material.map ) );

						}

						// possibly skip this sample if it's transparent or alpha test is enabled
						// alpha test is disabled when it === 0
						float alphaTest = material.alphaTest;
						bool useAlphaTest = alphaTest != 0.0;
						if (
							useAlphaTest && albedo.a < alphaTest
							|| ! useAlphaTest && albedo.a < rand()
						) {

							vec3 point = rayOrigin + rayDirection * dist;
							rayOrigin += rayDirection * dist - faceNormal * RAY_OFFSET;

							// only allow a limited number of transparency discards otherwise we could
							// crash the context with too long a loop.
							i -= sign( transparentTraversals );
							transparentTraversals --;
							continue;

						}

                        // fetch the interpolated smooth normal
                        vec3 normal = normalize( textureSampleBarycoord(
							normalAttribute,
							barycoord,
							faceIndices.xyz
						).xyz );

						// roughness
						float roughness = material.roughness;
						if ( material.roughnessMap != - 1 ) {

							roughness *= texture2D( textures, vec3( uv, material.roughnessMap ) ).r;

						}

						// metalness
						float metalness = material.metalness;
						if ( material.metalnessMap != - 1 ) {

							metalness *= texture2D( textures, vec3( uv, material.metalnessMap ) ).r;

						}

						// emission
						vec3 emission = material.emissiveIntensity * material.emissive;
						if ( material.emissiveMap != - 1 ) {

							emission *= texture2D( textures, vec3( uv, material.emissiveMap ) ).xyz;

						}

						// normal
						if ( material.normalMap != - 1 ) {

							vec4 tangentSample = textureSampleBarycoord(
								tangentAttribute,
								barycoord,
								faceIndices.xyz
							);

							// some provided tangents can be malformed (0, 0, 0) causing the normal to be degenerate
							// resulting in NaNs and slow path tracing.
							if ( length( tangentSample.xyz ) > 0.0 ) {

								vec3 tangent = normalize( tangentSample.xyz );
								vec3 bitangent = normalize( cross( normal, tangent ) * tangentSample.w );
								mat3 vTBN = mat3( tangent, bitangent, normal );

								vec3 texNormal = texture2D( textures, vec3( uv, material.normalMap ) ).xyz * 2.0 - 1.0;
								texNormal.xy *= material.normalScale;
								normal = vTBN * texNormal;

							}

						}

						normal *= side;

						MaterialRec materialRec;
						materialRec.transmission = material.transmission;
						materialRec.ior = material.ior;
						materialRec.emission = emission;
						materialRec.metalness = metalness;
						materialRec.color = albedo.rgb;

						// compute the filtered roughness value to use during specular reflection computations. A minimum
						// value of 1e-6 is needed because the GGX functions do not work with a roughness value of 0 and
						// the accumulated roughness value is scaled by a user setting and a "magic value" of 5.0.
						materialRec.roughness = clamp(
							max( material.roughness, accumulatedRoughness * filterGlossyFactor * 5.0 ),
							1e-3,
							1.0
						);

						SurfaceRec surfaceRec;
						surfaceRec.normal = normal;
						surfaceRec.faceNormal = faceNormal;
						surfaceRec.filteredRoughness = materialRec.roughness; // TODO: do we need this?
						surfaceRec.frontFace = side == 1.0;

						// TODO: transform into local basis and then back out
						mat3 normalBasis = getBasisFromNormal( surfaceRec.normal );
						mat3 invBasis = inverse( normalBasis );

						vec3 outgoing = - normalize( invBasis * rayDirection );
						SampleRec sampleRec = bsdfSample( outgoing, surfaceRec, materialRec );

						// determine if this is a rough normal or not by checking how far off straight up it is
						vec3 halfVector = normalize( outgoing + sampleRec.direction );
						accumulatedRoughness += sin( acos( halfVector.z ) );

                        // adjust the hit point by the surface normal by a factor of some offset and the
                        // maximum component-wise value of the current point to accommodate floating point
                        // error as values increase.
                        vec3 point = rayOrigin + rayDirection * dist;
                        vec3 absPoint = abs( point );
                        float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
                        rayDirection = normalize( normalBasis * sampleRec.direction );

						bool isBelowSurface = dot( rayDirection, faceNormal ) < 0.0;
                        rayOrigin = point + faceNormal * ( maxPoint + 1.0 ) * ( isBelowSurface ? - RAY_OFFSET : RAY_OFFSET );

						// accumulate color
						gl_FragColor.rgb += ( emission * throughputColor );

						// skip the sample if our PDF or ray is impossible
						if ( sampleRec.pdf <= 0.0 || ! isDirectionValid( rayDirection, normal, faceNormal) ) {

							break;

						}

						throughputColor *= sampleRec.color / sampleRec.pdf;

						// discard the sample if there are any NaNs
						if ( any( isnan( throughputColor ) ) || any( isinf( throughputColor ) ) ) {

							break;

						}

                    }

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
