import { Matrix4, Vector2 } from 'three';
import { MaterialBase } from '../MaterialBase.js';
import {
	MeshBVHUniformStruct, UIntVertexAttributeTexture,
	shaderStructs, shaderIntersectFunction,
} from 'three-mesh-bvh';

// uniforms
import { PhysicalCameraUniform } from '../../uniforms/PhysicalCameraUniform.js';
import { EquirectHdrInfoUniform } from '../../uniforms/EquirectHdrInfoUniform.js';
import { LightsInfoUniformStruct } from '../../uniforms/LightsInfoUniformStruct.js';
import { IESProfilesTexture } from '../../uniforms/IESProfilesTexture.js';
import { AttributesTextureArray } from '../../uniforms/AttributesTextureArray.js';
import { MaterialsTexture } from '../../uniforms/MaterialsTexture.js';
import { RenderTarget2DArray } from '../../uniforms/RenderTarget2DArray.js';

// glsl
import { cameraStructGLSL } from '../../shader/structs/cameraStruct.glsl.js';
import { equirectStructGLSL } from '../../shader/structs/equirectStruct.glsl.js';
import { lightsStructGLSL } from '../../shader/structs/lightsStruct.glsl.js';
import { materialStructGLSL } from '../../shader/structs/materialStruct.glsl.js';
import { fogMaterialBvhGLSL } from '../../shader/structs/fogMaterialBvh.glsl.js';

// material sampling
import { bsdfSamplingGLSL } from '../../shader/bsdf/bsdfSampling.glsl.js';
import { fogGLSL } from '../../shader/bsdf/fog.glsl.js';

// sampling
import { equirectSamplingGLSL } from '../../shader/sampling/equirectSampling.glsl.js';
import { lightSamplingGLSL } from '../../shader/sampling/lightSampling.glsl.js';
import { shapeSamplingGLSL } from '../../shader/sampling/shapeSampling.glsl.js';

// common glsl
import { intersectShapesGLSL } from '../../shader/common/intersectShapes.glsl';
import { mathGLSL } from '../../shader/common/math.glsl.js';
import { utilsGLSL } from '../../shader/common/utils.glsl.js';
import { fresnelGLSL } from '../../shader/common/fresnel.glsl.js';
import { arraySamplerTexelFetchGLSL } from '../../shader/common/arraySamplerTexelFetch.glsl.js';

// random glsl
import { pcgGLSL } from '../../shader/rand/pcg.glsl.js';
import { sobolCommonGLSL, sobolSamplingGLSL } from '../../shader/rand/sobol.glsl.js';

// path tracer utils
import { cameraUtilsGLSL } from './glsl/cameraUtils.glsl.js';
import { attenuateHitGLSL } from './glsl/attenuateHit.glsl.js';
import { traceSceneGLSL } from './glsl/traceScene.glsl.js';
import { getSurfaceRecordGLSL } from './glsl/getSurfaceRecord.glsl.js';

export class PhysicalPathTracingMaterial extends MaterialBase {

	onBeforeRender() {

		this.setDefine( 'FEATURE_DOF', this.physicalCamera.bokehSize === 0 ? 0 : 1 );
		this.setDefine( 'FEATURE_BACKGROUND_MAP', this.backgroundMap ? 1 : 0 );
		this.setDefine( 'FEATURE_FOG', this.materials.features.isUsed( 'FOG' ) ? 1 : 0 );

	}

	constructor( parameters ) {

		super( {

			transparent: true,
			depthWrite: false,

			defines: {
				FEATURE_MIS: 1,
				FEATURE_RUSSIAN_ROULETTE: 1,
				FEATURE_DOF: 1,
				FEATURE_BACKGROUND_MAP: 0,
				FEATURE_FOG: 1,
				// 0 = Perspective
				// 1 = Orthographic
				// 2 = Equirectangular
				CAMERA_TYPE: 0,

				ATTR_NORMAL: 0,
				ATTR_TANGENT: 1,
				ATTR_UV: 2,
				ATTR_COLOR: 3,
			},

			uniforms: {
				resolution: { value: new Vector2() },

				bounces: { value: 10 },
				transmissiveBounces: { value: 10 },
				physicalCamera: { value: new PhysicalCameraUniform() },

				bvh: { value: new MeshBVHUniformStruct() },
				attributesArray: { value: new AttributesTextureArray() },
				materialIndexAttribute: { value: new UIntVertexAttributeTexture() },
				materials: { value: new MaterialsTexture() },
				textures: { value: new RenderTarget2DArray().texture },
				lights: { value: new LightsInfoUniformStruct() },
				iesProfiles: { value: new IESProfilesTexture().texture },
				cameraWorldMatrix: { value: new Matrix4() },
				invProjectionMatrix: { value: new Matrix4() },
				backgroundBlur: { value: 0.0 },
				environmentIntensity: { value: 1.0 },
				environmentRotation: { value: new Matrix4() },
				envMapInfo: { value: new EquirectHdrInfoUniform() },
				backgroundMap: { value: null },

				seed: { value: 0 },
				opacity: { value: 1 },
				filterGlossyFactor: { value: 0.0 },

				backgroundAlpha: { value: 1.0 },
				sobolTexture: { value: null },
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
				#define RAY_OFFSET 1e-4
				#define INFINITY 1e20

				precision highp isampler2D;
				precision highp usampler2D;
				precision highp sampler2DArray;
				vec4 envMapTexelToLinear( vec4 a ) { return a; }
				#include <common>

				// bvh intersection
				${ shaderStructs }
				${ shaderIntersectFunction }

				// random
				${ pcgGLSL }
				${ sobolCommonGLSL }
				${ sobolSamplingGLSL }

				// common
				${ arraySamplerTexelFetchGLSL }
				${ fresnelGLSL }
				${ utilsGLSL }
				${ mathGLSL }
				${ intersectShapesGLSL }

				// uniform structs
				${ cameraStructGLSL }
				${ lightsStructGLSL }
				${ equirectStructGLSL }
				${ materialStructGLSL }
				${ fogMaterialBvhGLSL }

				// sampling
				${ shapeSamplingGLSL }
				${ bsdfSamplingGLSL }
				${ equirectSamplingGLSL }
				${ lightSamplingGLSL }
				${ fogGLSL }

				// environment
				uniform EquirectHdrInfo envMapInfo;
				uniform mat4 environmentRotation;
				uniform float environmentIntensity;

				// lighting
				uniform sampler2DArray iesProfiles;
				uniform LightsInfo lights;

				// background
				uniform float backgroundBlur;
				uniform float backgroundAlpha;
				#if FEATURE_BACKGROUND_MAP

				uniform sampler2D backgroundMap;

				#endif

				// camera
				uniform mat4 cameraWorldMatrix;
				uniform mat4 invProjectionMatrix;
				#if FEATURE_DOF

				uniform PhysicalCamera physicalCamera;

				#endif

				// geometry
				uniform sampler2DArray attributesArray;
				uniform usampler2D materialIndexAttribute;
				uniform sampler2D materials;
				uniform sampler2DArray textures;
				uniform BVH bvh;

				// path tracer
				uniform int bounces;
				uniform int transmissiveBounces;
				uniform float filterGlossyFactor;
				uniform int seed;

				// image
				uniform vec2 resolution;
				uniform float opacity;

				varying vec2 vUv;

				${ cameraUtilsGLSL }
				${ traceSceneGLSL }
				${ attenuateHitGLSL }

				float applyFilteredGlossy( float roughness, float accumulatedRoughness ) {

					return clamp(
						max(
							roughness,
							accumulatedRoughness * filterGlossyFactor * 5.0 ),
						0.0,
						1.0
					);

				}

				vec3 sampleBackground( vec3 direction, vec2 uv ) {

					vec3 sampleDir = normalize( direction + sampleHemisphere( direction, uv ) * 0.5 * backgroundBlur );

					#if FEATURE_BACKGROUND_MAP

					return sampleEquirectColor( backgroundMap, sampleDir );

					#else

					return environmentIntensity * sampleEquirectColor( envMapInfo.map, sampleDir );

					#endif

				}

				${ getSurfaceRecordGLSL }

				void main() {

					// init
					rng_initialize( gl_FragCoord.xy, seed );
					sobolPixelIndex = ( uint( gl_FragCoord.x ) << 16 ) | ( uint( gl_FragCoord.y ) );
					sobolPathIndex = uint( seed );

					// get camera ray
					vec3 rayDirection, rayOrigin;
					getCameraRay( rayDirection, rayOrigin );

					// inverse environment rotation
					mat3 envRotation3x3 = mat3( environmentRotation );
					mat3 invEnvRotation3x3 = inverse( envRotation3x3 );

					// final color
					gl_FragColor = vec4( 0.0 );
					gl_FragColor.a = 1.0;

					// hit results
					uvec4 faceIndices = uvec4( 0u );
					vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
					vec3 barycoord = vec3( 0.0 );
					float side = 1.0;
					float dist = 0.0;

					// path tracing state
					float accumulatedRoughness = 0.0;
					float accumulatedClearcoatRoughness = 0.0;
					bool transmissiveRay = true;
					bool isShadowRay = false;
					int transparentTraversals = transmissiveBounces;
					vec3 throughputColor = vec3( 1.0 );
					ScatterRecord sampleRec;
					int i;

					Material fogMaterial;
					#if FEATURE_FOG

					fogMaterial.fogVolume = bvhIntersectFogVolumeHit(
						bvh, rayOrigin, rayDirection,
						materialIndexAttribute, materials,
						fogMaterial
					);

					#endif

					for ( i = 0; i < bounces; i ++ ) {

						sobolBounceIndex ++;

						bool firstRay = i == 0 && transparentTraversals == transmissiveBounces;

						LightSampleRecord lightSampleRec;
						int hitType = traceScene(
							rayOrigin, rayDirection,
							bvh, lights, fogMaterial,
							faceIndices, faceNormal, barycoord, side, dist,
							lightSampleRec
						);

						if ( hitType == LIGHT_HIT ) {

							if ( firstRay || transmissiveRay ) {

								gl_FragColor.rgb += lightSampleRec.emission * throughputColor;

							} else {

								#if FEATURE_MIS

								// NOTE: we skip MIS for punctual lights since they are not supported in forward PT case
								if ( lightSampleRec.type == SPOT_LIGHT_TYPE || lightSampleRec.type == DIR_LIGHT_TYPE || lightSampleRec.type == POINT_LIGHT_TYPE ) {

									gl_FragColor.rgb += lightSampleRec.emission * throughputColor;

								} else {

									// weight the contribution
									float misWeight = misHeuristic( sampleRec.pdf, lightSampleRec.pdf / float( lights.count + 1u ) );
									gl_FragColor.rgb += lightSampleRec.emission * throughputColor * misWeight;

								}

								#else

								gl_FragColor.rgb += lightSampleRec.emission * throughputColor;

								#endif

							}
							break;

						} else if ( hitType == NO_HIT ) {

							if ( firstRay || transmissiveRay ) {

								gl_FragColor.rgb += sampleBackground( envRotation3x3 * rayDirection, sobol2( 2 ) ) * throughputColor;
								gl_FragColor.a = backgroundAlpha;

							} else {

								#if FEATURE_MIS

								// get the PDF of the hit envmap point
								vec3 envColor;
								float envPdf = sampleEquirect( envMapInfo, envRotation3x3 * rayDirection, envColor );
								envPdf /= float( lights.count + 1u );

								// and weight the contribution
								float misWeight = misHeuristic( sampleRec.pdf, envPdf );
								gl_FragColor.rgb += environmentIntensity * envColor * throughputColor * misWeight;

								#else

								gl_FragColor.rgb +=
									environmentIntensity *
									sampleEquirectColor( envMapInfo.map, envRotation3x3 * rayDirection ) *
									throughputColor;

								#endif

							}
							break;

						}

						uint materialIndex = uTexelFetch1D( materialIndexAttribute, faceIndices.x ).r;
						Material material = readMaterialInfo( materials, materialIndex );

						#if FEATURE_FOG

						if ( hitType == FOG_HIT ) {

							material = fogMaterial;

						} else if ( material.fogVolume ) {

							fogMaterial = material;
							fogMaterial.fogVolume = side == 1.0;

							rayOrigin = stepRayOrigin( rayOrigin, rayDirection, - faceNormal, dist );

							i -= sign( transparentTraversals );
							transparentTraversals -= sign( transparentTraversals );
							continue;

						}

						#endif

						if ( material.matte && firstRay ) {

							gl_FragColor = vec4( 0.0 );
							break;

						}

						// if we've determined that this is a shadow ray and we've hit an item with no shadow casting
						// then skip it
						if ( ! material.castShadow && isShadowRay ) {

							rayOrigin = stepRayOrigin( rayOrigin, rayDirection, - faceNormal, dist );
							continue;

						}

						SurfaceRecord surf;
						if (
							getSurfaceRecord(
								material, attributesArray, side, barycoord, faceIndices,
								faceNormal, accumulatedRoughness, accumulatedClearcoatRoughness,
								surf
							) == SKIP_SURFACE
						) {

							// only allow a limited number of transparency discards otherwise we could
							// crash the context with too long a loop.
							i -= sign( transparentTraversals );
							transparentTraversals -= sign( transparentTraversals );

							rayOrigin = stepRayOrigin( rayOrigin, rayDirection, - faceNormal, dist );
							continue;

						}

						faceNormal = surf.faceNormal;

						mat3 normalBasis = getBasisFromNormal( surf.normal );
						mat3 invBasis = inverse( normalBasis );

						mat3 clearcoatNormalBasis = getBasisFromNormal( surf.clearcoatNormal );
						mat3 clearcoatInvBasis = inverse( clearcoatNormalBasis );

						vec3 outgoing = - normalize( invBasis * rayDirection );
						vec3 clearcoatOutgoing = - normalize( clearcoatInvBasis * rayDirection );
						sampleRec = bsdfSample( outgoing, clearcoatOutgoing, normalBasis, invBasis, clearcoatNormalBasis, clearcoatInvBasis, surf );

						bool wasBelowSurface = ! material.fogVolume && dot( rayDirection, faceNormal ) > 0.0;
						isShadowRay = sampleRec.specularPdf < sobol( 4 );

						vec3 prevRayDirection = rayDirection;
						rayDirection = normalize( normalBasis * sampleRec.direction );

						bool isBelowSurface = ! material.fogVolume && dot( rayDirection, faceNormal ) < 0.0;
						rayOrigin = stepRayOrigin( rayOrigin, prevRayDirection, isBelowSurface ? - faceNormal : faceNormal, dist );

						// direct env map sampling
						#if FEATURE_MIS

						// uniformly pick a light or environment map
						if( sobol( 5 ) > 1.0 / float( lights.count + 1u ) ) {

							// sample a light or environment
							LightSampleRecord lightSampleRec = randomLightSample( lights.tex, iesProfiles, lights.count, rayOrigin, sobol3( 6 ) );

							bool isSampleBelowSurface = dot( faceNormal, lightSampleRec.direction ) < 0.0;
							if ( isSampleBelowSurface ) {

								lightSampleRec.pdf = 0.0;

							}

							// check if a ray could even reach the light area
							vec3 attenuatedColor;
							if (
								lightSampleRec.pdf > 0.0 &&
								isDirectionValid( lightSampleRec.direction, surf.normal, faceNormal ) &&
								! attenuateHit( bvh, rayOrigin, lightSampleRec.direction, lightSampleRec.dist, bounces - i, transparentTraversals, isShadowRay, fogMaterial, attenuatedColor )
							) {

								// get the material pdf
								vec3 sampleColor;
								float lightMaterialPdf = bsdfResult( outgoing, clearcoatOutgoing, normalize( invBasis * lightSampleRec.direction ), normalize( clearcoatInvBasis * lightSampleRec.direction ), surf, sampleColor );
								bool isValidSampleColor = all( greaterThanEqual( sampleColor, vec3( 0.0 ) ) );
								if ( lightMaterialPdf > 0.0 && isValidSampleColor ) {

									// weight the direct light contribution
									float lightPdf = lightSampleRec.pdf / float( lights.count + 1u );
									float misWeight = lightSampleRec.type == SPOT_LIGHT_TYPE || lightSampleRec.type == DIR_LIGHT_TYPE || lightSampleRec.type == POINT_LIGHT_TYPE ? 1.0 : misHeuristic( lightPdf, lightMaterialPdf );
									gl_FragColor.rgb += attenuatedColor * lightSampleRec.emission * throughputColor * sampleColor * misWeight / lightPdf;

								}

							}

						} else {

							// find a sample in the environment map to include in the contribution
							vec3 envColor, envDirection;
							float envPdf = sampleEquirectProbability( envMapInfo, sobol2( 7 ), envColor, envDirection );
							envDirection = invEnvRotation3x3 * envDirection;

							// this env sampling is not set up for transmissive sampling and yields overly bright
							// results so we ignore the sample in this case.
							// TODO: this should be improved but how? The env samples could traverse a few layers?
							bool isSampleBelowSurface = dot( faceNormal, envDirection ) < 0.0;
							if ( isSampleBelowSurface ) {

								envPdf = 0.0;

							}

							// check if a ray could even reach the surface
							vec3 attenuatedColor;
							if (
								envPdf > 0.0 &&
								isDirectionValid( envDirection, surf.normal, faceNormal ) &&
								! attenuateHit( bvh, rayOrigin, envDirection, INFINITY, bounces - i, transparentTraversals, isShadowRay, fogMaterial, attenuatedColor )
							) {

								// get the material pdf
								vec3 sampleColor;
								float envMaterialPdf = bsdfResult( outgoing, clearcoatOutgoing, normalize( invBasis * envDirection ), normalize( clearcoatInvBasis * envDirection ), surf, sampleColor );
								bool isValidSampleColor = all( greaterThanEqual( sampleColor, vec3( 0.0 ) ) );
								if ( envMaterialPdf > 0.0 && isValidSampleColor ) {

									// weight the direct light contribution
									envPdf /= float( lights.count + 1u );
									float misWeight = misHeuristic( envPdf, envMaterialPdf );
									gl_FragColor.rgb += attenuatedColor * environmentIntensity * envColor * throughputColor * sampleColor * misWeight / envPdf;

								}

							}

						}
						#endif

						// accumulate a roughness value to offset diffuse, specular, diffuse rays that have high contribution
						// to a single pixel resulting in fireflies
						if ( ! isBelowSurface ) {

							// TODO: is this correct?
							// determine if this is a rough normal or not by checking how far off straight up it is
							vec3 halfVector = normalize( outgoing + sampleRec.direction );
							accumulatedRoughness += sin( acosApprox( halfVector.z ) );

							vec3 clearcoatHalfVector = normalize( clearcoatOutgoing + sampleRec.clearcoatDirection );
							accumulatedClearcoatRoughness += sin( acosApprox( clearcoatHalfVector.z ) );

							transmissiveRay = false;

						}

						// if we're bouncing around the inside a transmissive material then decrement
						// perform this separate from a bounce
						bool isTransmissiveRay = dot( rayDirection, faceNormal * side ) < 0.0;
						if ( ( isTransmissiveRay || isBelowSurface || material.fogVolume ) && transparentTraversals > 0 ) {

							transparentTraversals --;
							i --;

						}

						// accumulate color
						gl_FragColor.rgb += ( surf.emission * throughputColor );

						// skip the sample if our PDF or ray is impossible
						if ( sampleRec.pdf <= 0.0 || ! isDirectionValid( rayDirection, surf.normal, faceNormal ) ) {

							break;

						}

						#if FEATURE_RUSSIAN_ROULETTE

						// russian roulette path termination
						// https://www.arnoldrenderer.com/research/physically_based_shader_design_in_arnold.pdf
						uint minBounces = 3u;
						float depthProb = float( sobolBounceIndex < minBounces );

						float rrProb = luminance( throughputColor * sampleRec.color / sampleRec.pdf );
						rrProb /= luminance( throughputColor );
						rrProb = sqrt( rrProb );
						rrProb = max( rrProb, depthProb );
						rrProb = min( rrProb, 1.0 );
						if ( sobol( 8 ) > rrProb ) {

							break;

						}

						// perform sample clamping here to avoid bright pixels
						throughputColor *= min( 1.0 / rrProb, 20.0 );

						#endif

						throughputColor *= sampleRec.color / sampleRec.pdf;

						// attenuate the throughput color by the medium color
						if ( side == - 1.0 ) {

							throughputColor *= transmissionAttenuation( dist, surf.attenuationColor, surf.attenuationDistance );

						}

						// discard the sample if there are any NaNs
						if ( any( isnan( throughputColor ) ) || any( isinf( throughputColor ) ) ) {

							break;

						}


					}

					gl_FragColor.a *= opacity;

				}

			`

		} );

		this.setValues( parameters );

	}

}
