import { Matrix4, Vector2 } from 'three';
import { MaterialBase } from './MaterialBase.js';
import {
	MeshBVHUniformStruct, UIntVertexAttributeTexture,
	shaderStructs, shaderIntersectFunction,
} from 'three-mesh-bvh';
import { shaderMaterialStructs, shaderLightStruct } from '../shader/shaderStructs.js';
import { MaterialsTexture } from '../uniforms/MaterialsTexture.js';
import { RenderTarget2DArray } from '../uniforms/RenderTarget2DArray.js';
import { shaderMaterialSampling } from '../shader/shaderMaterialSampling.js';
import { shaderEnvMapSampling } from '../shader/shaderEnvMapSampling.js';
import { shaderLightSampling } from '../shader/shaderLightSampling.js';
import { shaderSobolCommon, shaderSobolSampling } from '../shader/shaderSobolSampling.js';
import { shaderUtils } from '../shader/shaderUtils.js';
import { shaderLayerTexelFetchFunctions } from '../shader/shaderLayerTexelFetchFunctions.js';
import { shaderRandFunctions } from '../shader/shaderRandFunctions.js';
import { PhysicalCameraUniform } from '../uniforms/PhysicalCameraUniform.js';
import { EquirectHdrInfoUniform } from '../uniforms/EquirectHdrInfoUniform.js';
import { LightsInfoUniformStruct } from '../uniforms/LightsInfoUniformStruct.js';
import { IESProfilesTexture } from '../uniforms/IESProfilesTexture.js';
import { AttributesTextureArray } from '../uniforms/AttributesTextureArray.js';

export class PhysicalPathTracingMaterial extends MaterialBase {

	onBeforeRender() {

		this.setDefine( 'FEATURE_DOF', this.physicalCamera.bokehSize === 0 ? 0 : 1 );
		this.setDefine( 'FEATURE_BACKGROUND_MAP', this.backgroundMap ? 1 : 0 );

	}

	constructor( parameters ) {

		super( {

			transparent: true,
			depthWrite: false,

			defines: {
				FEATURE_MIS: 1,
				FEATURE_DOF: 1,
				FEATURE_BACKGROUND_MAP: 0,
				TRANSPARENT_TRAVERSALS: 5,
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

				bounces: { value: 3 },
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

				precision highp isampler2D;
				precision highp usampler2D;
				precision highp sampler2DArray;
				vec4 envMapTexelToLinear( vec4 a ) { return a; }
				#include <common>

				${ shaderRandFunctions }
				${ shaderSobolCommon }
				${ shaderSobolSampling }
				${ shaderStructs }
				${ shaderIntersectFunction }
				${ shaderMaterialStructs }
				${ shaderLightStruct }

				${ shaderLayerTexelFetchFunctions }
				${ shaderUtils }
				${ shaderMaterialSampling }
				${ shaderEnvMapSampling }

				uniform mat4 environmentRotation;
				uniform float backgroundBlur;
				uniform float backgroundAlpha;

				#if FEATURE_BACKGROUND_MAP

				uniform sampler2D backgroundMap;

				#endif

				#if FEATURE_DOF

				uniform PhysicalCamera physicalCamera;

				#endif

				uniform vec2 resolution;
				uniform int bounces;
				uniform mat4 cameraWorldMatrix;
				uniform mat4 invProjectionMatrix;
				uniform sampler2DArray attributesArray;
				uniform usampler2D materialIndexAttribute;
				uniform BVH bvh;
				uniform float environmentIntensity;
				uniform float filterGlossyFactor;
				uniform int seed;
				uniform float opacity;
				uniform sampler2D materials;
				uniform LightsInfo lights;
				uniform sampler2DArray iesProfiles;

				${ shaderLightSampling }

				uniform EquirectHdrInfo envMapInfo;

				uniform sampler2DArray textures;
				varying vec2 vUv;

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

					vec3 sampleDir = normalize( direction + getHemisphereSample( direction, uv ) * 0.5 * backgroundBlur );

					#if FEATURE_BACKGROUND_MAP

					return sampleEquirectEnvMapColor( sampleDir, backgroundMap );

					#else

					return environmentIntensity * sampleEquirectEnvMapColor( sampleDir, envMapInfo.map );

					#endif

				}

				// step through multiple surface hits and accumulate color attenuation based on transmissive surfaces
				bool attenuateHit( BVH bvh, vec3 rayOrigin, vec3 rayDirection, int traversals, bool isShadowRay, out vec3 color ) {

					// hit results
					uvec4 faceIndices = uvec4( 0u );
					vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
					vec3 barycoord = vec3( 0.0 );
					float side = 1.0;
					float dist = 0.0;

					color = vec3( 1.0 );

					// TODO: we should be using sobol sampling here instead of rand but the sobol bounce and path indices need to be incremented
					// and then reset.
					for ( int i = 0; i < traversals; i ++ ) {

						if ( bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist ) ) {

							// TODO: attenuate the contribution based on the PDF of the resulting ray including refraction values
							// Should be able to work using the material BSDF functions which will take into account specularity, etc.
							// TODO: should we account for emissive surfaces here?

							vec2 uv = textureSampleBarycoord( attributesArray, ATTR_UV, barycoord, faceIndices.xyz ).xy;
							vec4 vertexColor = textureSampleBarycoord( attributesArray, ATTR_COLOR, barycoord, faceIndices.xyz );

							uint materialIndex = uTexelFetch1D( materialIndexAttribute, faceIndices.x ).r;
							Material material = readMaterialInfo( materials, materialIndex );

							// adjust the ray to the new surface
							bool isBelowSurface = dot( rayDirection, faceNormal ) < 0.0;
							vec3 point = rayOrigin + rayDirection * dist;
							vec3 absPoint = abs( point );
							float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
							rayOrigin = point + faceNormal * ( maxPoint + 1.0 ) * ( isBelowSurface ? - RAY_OFFSET : RAY_OFFSET );

							if ( ! material.castShadow && isShadowRay ) {

								continue;

							}

							// Opacity Test

							// albedo
							vec4 albedo = vec4( material.color, material.opacity );
							if ( material.map != - 1 ) {

								vec3 uvPrime = material.mapTransform * vec3( uv, 1 );
								albedo *= texture2D( textures, vec3( uvPrime.xy, material.map ) );

							}

							if ( material.vertexColors ) {

								albedo *= vertexColor;

							}

							// alphaMap
							if ( material.alphaMap != - 1 ) {

								albedo.a *= texture2D( textures, vec3( uv, material.alphaMap ) ).x;

							}

							// transmission
							float transmission = material.transmission;
							if ( material.transmissionMap != - 1 ) {

								vec3 uvPrime = material.transmissionMapTransform * vec3( uv, 1 );
								transmission *= texture2D( textures, vec3( uvPrime.xy, material.transmissionMap ) ).r;

							}

							// metalness
							float metalness = material.metalness;
							if ( material.metalnessMap != - 1 ) {

								vec3 uvPrime = material.metalnessMapTransform * vec3( uv, 1 );
								metalness *= texture2D( textures, vec3( uvPrime.xy, material.metalnessMap ) ).b;

							}

							float alphaTest = material.alphaTest;
							bool useAlphaTest = alphaTest != 0.0;
							float transmissionFactor = ( 1.0 - metalness ) * transmission;
							if (
								transmissionFactor < rand() && ! (
									// material sidedness
									material.side != 0.0 && side == material.side

									// alpha test
									|| useAlphaTest && albedo.a < alphaTest

									// opacity
									|| material.transparent && ! useAlphaTest && albedo.a < rand()
								)
							) {

								return true;

							}

							if ( side == 1.0 && isBelowSurface ) {

								// only attenuate by surface color on the way in
								color *= mix( vec3( 1.0 ), albedo.rgb, transmissionFactor );

							} else if ( side == - 1.0 ) {

								// attenuate by medium once we hit the opposite side of the model
								color *= transmissionAttenuation( dist, material.attenuationColor, material.attenuationDistance );

							}

						} else {

							return false;

						}

					}

					return true;

				}

				// returns whether the ray hit anything before a certain distance, not just the first surface. Could be optimized to not check the full hierarchy.
				bool anyCloserHit( BVH bvh, vec3 rayOrigin, vec3 rayDirection, float maxDist ) {

					uvec4 faceIndices = uvec4( 0u );
					vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
					vec3 barycoord = vec3( 0.0 );
					float side = 1.0;
					float dist = 0.0;
					bool hit = bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist );
					return hit && dist < maxDist;

				}

				vec3 ndcToRayOrigin( vec2 coord ) {

					vec4 rayOrigin4 = cameraWorldMatrix * invProjectionMatrix * vec4( coord, - 1.0, 1.0 );
					return rayOrigin4.xyz / rayOrigin4.w;
				}

				void getCameraRay( out vec3 rayDirection, out vec3 rayOrigin ) {

					vec2 ssd = vec2( 1.0 ) / resolution;

					// Jitter the camera ray by finding a uv coordinate at a random sample
					// around this pixel's UV coordinate for AA
					vec2 ruv = sobol2( 0 );
					vec2 jitteredUv = vUv + vec2( tentFilter( ruv.x ) * ssd.x, tentFilter( ruv.y ) * ssd.y );

					#if CAMERA_TYPE == 2

						// Equirectangular projection
						vec4 rayDirection4 = vec4( equirectUvToDirection( jitteredUv ), 0.0 );
						vec4 rayOrigin4 = vec4( 0.0, 0.0, 0.0, 1.0 );

						rayDirection4 = cameraWorldMatrix * rayDirection4;
						rayOrigin4 = cameraWorldMatrix * rayOrigin4;

						rayDirection = normalize( rayDirection4.xyz );
						rayOrigin = rayOrigin4.xyz / rayOrigin4.w;

					#else

						// get [- 1, 1] normalized device coordinates
						vec2 ndc = 2.0 * jitteredUv - vec2( 1.0 );
						rayOrigin = ndcToRayOrigin( ndc );

						#if CAMERA_TYPE == 1

							// Orthographic projection
							rayDirection = ( cameraWorldMatrix * vec4( 0.0, 0.0, - 1.0, 0.0 ) ).xyz;
							rayDirection = normalize( rayDirection );

						#else

							// Perspective projection
							rayDirection = normalize( mat3(cameraWorldMatrix) * ( invProjectionMatrix * vec4( ndc, 0.0, 1.0 ) ).xyz );

						#endif

					#endif

					#if FEATURE_DOF
					{

						// depth of field
						vec3 focalPoint = rayOrigin + normalize( rayDirection ) * physicalCamera.focusDistance;

						// get the aperture sample
						// if blades === 0 then we assume a circle
						vec3 shapeUVW= sobol3( 1 );
						int blades = physicalCamera.apertureBlades;
						float anamorphicRatio = physicalCamera.anamorphicRatio;
						vec2 apertureSample = blades == 0 ? sampleCircle( shapeUVW.xy ) : sampleRegularNGon( blades, shapeUVW );
						apertureSample *= physicalCamera.bokehSize * 0.5 * 1e-3;

						// rotate the aperture shape
						apertureSample =
							rotateVector( apertureSample, physicalCamera.apertureRotation ) *
							saturate( vec2( anamorphicRatio, 1.0 / anamorphicRatio ) );

						// create the new ray
						rayOrigin += ( cameraWorldMatrix * vec4( apertureSample, 0.0, 0.0 ) ).xyz;
						rayDirection = focalPoint - rayOrigin;

					}
					#endif

					rayDirection = normalize( rayDirection );

				}

				void main() {

					rng_initialize( gl_FragCoord.xy, seed );
					sobolPixelIndex = ( uint( gl_FragCoord.x ) << 16 ) | ( uint( gl_FragCoord.y ) );
					sobolPathIndex = uint( seed );

					vec3 rayDirection;
					vec3 rayOrigin;

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
					int transparentTraversals = TRANSPARENT_TRAVERSALS;
					vec3 throughputColor = vec3( 1.0 );
					SampleRec sampleRec;
					int i;
					bool isShadowRay = false;

					for ( i = 0; i < bounces; i ++ ) {

						sobolBounceIndex ++;

						bool hit = bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist );

						LightSampleRec lightHit = lightsClosestHit( lights.tex, lights.count, rayOrigin, rayDirection );

						if ( lightHit.hit && ( lightHit.dist < dist || !hit ) ) {

							if ( i == 0 || transmissiveRay ) {

								gl_FragColor.rgb += lightHit.emission * throughputColor;

							} else {

								#if FEATURE_MIS

								// NOTE: we skip MIS for punctual lights since they are not supported in forward PT case
								if ( lightHit.type == SPOT_LIGHT_TYPE || lightHit.type == DIR_LIGHT_TYPE || lightHit.type == POINT_LIGHT_TYPE ) {

									gl_FragColor.rgb += lightHit.emission * throughputColor;

								} else {

									// weight the contribution
									float misWeight = misHeuristic( sampleRec.pdf, lightHit.pdf / float( lights.count + 1u ) );
									gl_FragColor.rgb += lightHit.emission * throughputColor * misWeight;

								}

								#else

								gl_FragColor.rgb += lightHit.emission * throughputColor;

								#endif

							}
							break;

						}

						if ( ! hit ) {

							if ( i == 0 || transmissiveRay ) {

								gl_FragColor.rgb += sampleBackground( envRotation3x3 * rayDirection, sobol2( 2 ) ) * throughputColor;
								gl_FragColor.a = backgroundAlpha;

							} else {

								#if FEATURE_MIS

								// get the PDF of the hit envmap point
								vec3 envColor;
								float envPdf = sampleEnvMap( envMapInfo, envRotation3x3 * rayDirection, envColor );
								envPdf /= float( lights.count + 1u );

								// and weight the contribution
								float misWeight = misHeuristic( sampleRec.pdf, envPdf );
								gl_FragColor.rgb += environmentIntensity * envColor * throughputColor * misWeight;

								#else

								gl_FragColor.rgb +=
									environmentIntensity *
									sampleEquirectEnvMapColor( envRotation3x3 * rayDirection, envMapInfo.map ) *
									throughputColor;

								#endif

							}
							break;

						}

						uint materialIndex = uTexelFetch1D( materialIndexAttribute, faceIndices.x ).r;
						Material material = readMaterialInfo( materials, materialIndex );

						if ( material.matte && i == 0 ) {

							gl_FragColor = vec4( 0.0 );
							break;

						}

						// if we've determined that this is a shadow ray and we've hit an item with no shadow casting
						// then skip it
						if ( ! material.castShadow && isShadowRay ) {

							vec3 point = rayOrigin + rayDirection * dist;
							vec3 absPoint = abs( point );
							float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
							rayOrigin = point - ( maxPoint + 1.0 ) * faceNormal * RAY_OFFSET;

							continue;

						}

						// uv coord for textures
						vec2 uv = textureSampleBarycoord( attributesArray, ATTR_UV, barycoord, faceIndices.xyz ).xy;
						vec4 vertexColor = textureSampleBarycoord( attributesArray, ATTR_COLOR, barycoord, faceIndices.xyz );

						// albedo
						vec4 albedo = vec4( material.color, material.opacity );
						if ( material.map != - 1 ) {

							vec3 uvPrime = material.mapTransform * vec3( uv, 1 );
							albedo *= texture2D( textures, vec3( uvPrime.xy, material.map ) );
						}

						if ( material.vertexColors ) {

							albedo *= vertexColor;

						}

						// alphaMap
						if ( material.alphaMap != - 1 ) {

							albedo.a *= texture2D( textures, vec3( uv, material.alphaMap ) ).x;

						}

						// possibly skip this sample if it's transparent, alpha test is enabled, or we hit the wrong material side
						// and it's single sided.
						// - alpha test is disabled when it === 0
						// - the material sidedness test is complicated because we want light to pass through the back side but still
						// be able to see the front side. This boolean checks if the side we hit is the front side on the first ray
						// and we're rendering the other then we skip it. Do the opposite on subsequent bounces to get incoming light.
						float alphaTest = material.alphaTest;
						bool useAlphaTest = alphaTest != 0.0;
						if (
							// material sidedness
							material.side != 0.0 && side != material.side

							// alpha test
							|| useAlphaTest && albedo.a < alphaTest

							// opacity
							|| material.transparent && ! useAlphaTest && albedo.a < sobol( 3 )
						) {

							vec3 point = rayOrigin + rayDirection * dist;
							vec3 absPoint = abs( point );
							float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
							rayOrigin = point - ( maxPoint + 1.0 ) * faceNormal * RAY_OFFSET;

							// only allow a limited number of transparency discards otherwise we could
							// crash the context with too long a loop.
							i -= sign( transparentTraversals );
							transparentTraversals -= sign( transparentTraversals );
							continue;

						}

						// fetch the interpolated smooth normal
						vec3 normal = normalize( textureSampleBarycoord(
							attributesArray,
							ATTR_NORMAL,
							barycoord,
							faceIndices.xyz
						).xyz );

						// roughness
						float roughness = material.roughness;
						if ( material.roughnessMap != - 1 ) {

							vec3 uvPrime = material.roughnessMapTransform * vec3( uv, 1 );
							roughness *= texture2D( textures, vec3( uvPrime.xy, material.roughnessMap ) ).g;

						}

						// metalness
						float metalness = material.metalness;
						if ( material.metalnessMap != - 1 ) {

							vec3 uvPrime = material.metalnessMapTransform * vec3( uv, 1 );
							metalness *= texture2D( textures, vec3( uvPrime.xy, material.metalnessMap ) ).b;

						}

						// emission
						vec3 emission = material.emissiveIntensity * material.emissive;
						if ( material.emissiveMap != - 1 ) {

							vec3 uvPrime = material.emissiveMapTransform * vec3( uv, 1 );
							emission *= texture2D( textures, vec3( uvPrime.xy, material.emissiveMap ) ).xyz;

						}

						// transmission
						float transmission = material.transmission;
						if ( material.transmissionMap != - 1 ) {

							vec3 uvPrime = material.transmissionMapTransform * vec3( uv, 1 );
							transmission *= texture2D( textures, vec3( uvPrime.xy, material.transmissionMap ) ).r;

						}

						// normal
						if ( material.flatShading ) {

							// if we're rendering a flat shaded object then use the face normals - the face normal
							// is provided based on the side the ray hits the mesh so flip it to align with the
							// interpolated vertex normals.
							normal = faceNormal * side;

						}

						vec3 baseNormal = normal;
						if ( material.normalMap != - 1 ) {

							vec4 tangentSample = textureSampleBarycoord(
								attributesArray,
								ATTR_TANGENT,
								barycoord,
								faceIndices.xyz
							);

							// some provided tangents can be malformed (0, 0, 0) causing the normal to be degenerate
							// resulting in NaNs and slow path tracing.
							if ( length( tangentSample.xyz ) > 0.0 ) {

								vec3 tangent = normalize( tangentSample.xyz );
								vec3 bitangent = normalize( cross( normal, tangent ) * tangentSample.w );
								mat3 vTBN = mat3( tangent, bitangent, normal );

								vec3 uvPrime = material.normalMapTransform * vec3( uv, 1 );
								vec3 texNormal = texture2D( textures, vec3( uvPrime.xy, material.normalMap ) ).xyz * 2.0 - 1.0;
								texNormal.xy *= material.normalScale;
								normal = vTBN * texNormal;

							}

						}

						normal *= side;

						// clearcoat
						float clearcoat = material.clearcoat;
						if ( material.clearcoatMap != - 1 ) {

							vec3 uvPrime = material.clearcoatMapTransform * vec3( uv, 1 );
							clearcoat *= texture2D( textures, vec3( uvPrime.xy, material.clearcoatMap ) ).r;

						}

						// clearcoatRoughness
						float clearcoatRoughness = material.clearcoatRoughness;
						if ( material.clearcoatRoughnessMap != - 1 ) {

							vec3 uvPrime = material.clearcoatRoughnessMapTransform * vec3( uv, 1 );
							clearcoat *= texture2D( textures, vec3( uvPrime.xy, material.clearcoatRoughnessMap ) ).g;

						}

						// clearcoatNormal
						vec3 clearcoatNormal = baseNormal;
						if ( material.clearcoatNormalMap != - 1 ) {

							vec4 tangentSample = textureSampleBarycoord(
								attributesArray,
								ATTR_TANGENT,
								barycoord,
								faceIndices.xyz
							);

							// some provided tangents can be malformed (0, 0, 0) causing the normal to be degenerate
							// resulting in NaNs and slow path tracing.
							if ( length( tangentSample.xyz ) > 0.0 ) {

								vec3 tangent = normalize( tangentSample.xyz );
								vec3 bitangent = normalize( cross( clearcoatNormal, tangent ) * tangentSample.w );
								mat3 vTBN = mat3( tangent, bitangent, clearcoatNormal );

								vec3 uvPrime = material.clearcoatNormalMapTransform * vec3( uv, 1 );
								vec3 texNormal = texture2D( textures, vec3( uvPrime.xy, material.clearcoatNormalMap ) ).xyz * 2.0 - 1.0;
								texNormal.xy *= material.clearcoatNormalScale;
								clearcoatNormal = vTBN * texNormal;

							}

						}

						clearcoatNormal *= side;

						// sheenColor
						vec3 sheenColor = material.sheenColor;
						if ( material.sheenColorMap != - 1 ) {

							vec3 uvPrime = material.sheenColorMapTransform * vec3( uv, 1 );
							sheenColor *= texture2D( textures, vec3( uvPrime.xy, material.sheenColorMap ) ).rgb;

						}

						// sheenRoughness
						float sheenRoughness = material.sheenRoughness;
						if ( material.sheenRoughnessMap != - 1 ) {

							vec3 uvPrime = material.sheenRoughnessMapTransform * vec3( uv, 1 );
							sheenRoughness *= texture2D( textures, vec3( uvPrime.xy, material.sheenRoughnessMap ) ).a;

						}

						// iridescence
						float iridescence = material.iridescence;
						if ( material.iridescenceMap != - 1 ) {

							vec3 uvPrime = material.iridescenceMapTransform * vec3( uv, 1 );
							iridescence *= texture2D( textures, vec3( uvPrime.xy, material.iridescenceMap ) ).r;

						}

						// iridescence thickness
						float iridescenceThickness = material.iridescenceThicknessMaximum;
						if ( material.iridescenceThicknessMap != - 1 ) {

							vec3 uvPrime = material.iridescenceThicknessMapTransform * vec3( uv, 1 );
							float iridescenceThicknessSampled = texture2D( textures, vec3( uvPrime.xy, material.iridescenceThicknessMap ) ).g;
							iridescenceThickness = mix( material.iridescenceThicknessMinimum, material.iridescenceThicknessMaximum, iridescenceThicknessSampled );

						}

						iridescence = iridescenceThickness == 0.0 ? 0.0 : iridescence;

						// specular color
						vec3 specularColor = material.specularColor;
						if ( material.specularColorMap != - 1 ) {

							vec3 uvPrime = material.specularColorMapTransform * vec3( uv, 1 );
							specularColor *= texture2D( textures, vec3( uvPrime.xy, material.specularColorMap ) ).rgb;

						}

						// specular intensity
						float specularIntensity = material.specularIntensity;
						if ( material.specularIntensityMap != - 1 ) {

							vec3 uvPrime = material.specularIntensityMapTransform * vec3( uv, 1 );
							specularIntensity *= texture2D( textures, vec3( uvPrime.xy, material.specularIntensityMap ) ).a;

						}

						SurfaceRec surfaceRec;
						surfaceRec.normal = normal;
						surfaceRec.faceNormal = faceNormal;
						surfaceRec.transmission = transmission;
						surfaceRec.ior = material.ior;
						surfaceRec.emission = emission;
						surfaceRec.metalness = metalness;
						surfaceRec.color = albedo.rgb;
						surfaceRec.clearcoat = clearcoat;
						surfaceRec.sheenColor = sheenColor;
						surfaceRec.iridescence = iridescence;
						surfaceRec.iridescenceIor = material.iridescenceIor;
						surfaceRec.iridescenceThickness = iridescenceThickness;
						surfaceRec.specularColor = specularColor;
						surfaceRec.specularIntensity = specularIntensity;
						surfaceRec.attenuationColor = material.attenuationColor;
						surfaceRec.attenuationDistance = material.attenuationDistance;

						// apply perceptual roughness factor from gltf
						// https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#microfacet-surfaces
						surfaceRec.roughness = roughness * roughness;
						surfaceRec.clearcoatRoughness = clearcoatRoughness * clearcoatRoughness;
						surfaceRec.sheenRoughness = sheenRoughness * sheenRoughness;

						// frontFace is used to determine transmissive properties and PDF. If no transmission is used
						// then we can just always assume this is a front face.
						surfaceRec.frontFace = side == 1.0 || transmission == 0.0;
						surfaceRec.eta = material.thinFilm || surfaceRec.frontFace ? 1.0 / material.ior : material.ior;
						surfaceRec.f0 = iorRatioToF0( surfaceRec.eta );
						surfaceRec.thinFilm = material.thinFilm;

						// Compute the filtered roughness value to use during specular reflection computations.
						// The accumulated roughness value is scaled by a user setting and a "magic value" of 5.0.
						// If we're exiting something transmissive then scale the factor down significantly so we can retain
						// sharp internal reflections
						surfaceRec.filteredRoughness = applyFilteredGlossy( surfaceRec.roughness, accumulatedRoughness );
						surfaceRec.filteredClearcoatRoughness = applyFilteredGlossy( surfaceRec.clearcoatRoughness, accumulatedClearcoatRoughness );

						mat3 normalBasis = getBasisFromNormal( surfaceRec.normal );
						mat3 invBasis = inverse( normalBasis );

						mat3 clearcoatNormalBasis = getBasisFromNormal( clearcoatNormal );
						mat3 clearcoatInvBasis = inverse( clearcoatNormalBasis );

						vec3 outgoing = - normalize( invBasis * rayDirection );
						vec3 clearcoatOutgoing = - normalize( clearcoatInvBasis * rayDirection );
						sampleRec = bsdfSample( outgoing, clearcoatOutgoing, normalBasis, invBasis, clearcoatNormalBasis, clearcoatInvBasis, surfaceRec );

						isShadowRay = sampleRec.specularPdf < sobol( 4 );

						// adjust the hit point by the surface normal by a factor of some offset and the
						// maximum component-wise value of the current point to accommodate floating point
						// error as values increase.
						vec3 point = rayOrigin + rayDirection * dist;
						vec3 absPoint = abs( point );
						float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
						rayDirection = normalize( normalBasis * sampleRec.direction );

						bool isBelowSurface = dot( rayDirection, faceNormal ) < 0.0;
						rayOrigin = point + faceNormal * ( maxPoint + 1.0 ) * ( isBelowSurface ? - RAY_OFFSET : RAY_OFFSET );

						// direct env map sampling
						#if FEATURE_MIS

						// uniformly pick a light or environment map
						if( sobol( 5 ) > 1.0 / float( lights.count + 1u ) ) {

							// sample a light or environment
							LightSampleRec lightSampleRec = randomLightSample( lights.tex, iesProfiles, lights.count, rayOrigin, sobol3( 6 ) );

							bool isSampleBelowSurface = dot( faceNormal, lightSampleRec.direction ) < 0.0;
							if ( isSampleBelowSurface ) {

								lightSampleRec.pdf = 0.0;

							}

							// check if a ray could even reach the light area
							if (
								lightSampleRec.pdf > 0.0 &&
								isDirectionValid( lightSampleRec.direction, normal, faceNormal ) &&
								! anyCloserHit( bvh, rayOrigin, lightSampleRec.direction, lightSampleRec.dist )
							) {

								// get the material pdf
								vec3 sampleColor;
								float lightMaterialPdf = bsdfResult( outgoing, clearcoatOutgoing, normalize( invBasis * lightSampleRec.direction ), normalize( clearcoatInvBasis * lightSampleRec.direction ), surfaceRec, sampleColor );
								bool isValidSampleColor = all( greaterThanEqual( sampleColor, vec3( 0.0 ) ) );
								if ( lightMaterialPdf > 0.0 && isValidSampleColor ) {

									// weight the direct light contribution
									float lightPdf = lightSampleRec.pdf / float( lights.count + 1u );
									float misWeight = lightSampleRec.type == SPOT_LIGHT_TYPE || lightSampleRec.type == DIR_LIGHT_TYPE || lightSampleRec.type == POINT_LIGHT_TYPE ? 1.0 : misHeuristic( lightPdf, lightMaterialPdf );
									gl_FragColor.rgb += lightSampleRec.emission * throughputColor * sampleColor * misWeight / lightPdf;

								}

							}

						} else {

							// find a sample in the environment map to include in the contribution
							vec3 envColor, envDirection;
							float envPdf = sampleEnvMapProbability( envMapInfo, sobol2( 7 ), envColor, envDirection );
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
								isDirectionValid( envDirection, normal, faceNormal ) &&
								! attenuateHit( bvh, rayOrigin, envDirection, bounces - i, isShadowRay, attenuatedColor )
							) {

								// get the material pdf
								vec3 sampleColor;
								float envMaterialPdf = bsdfResult( outgoing, clearcoatOutgoing, normalize( invBasis * envDirection ), normalize( clearcoatInvBasis * envDirection ), surfaceRec, sampleColor );
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

							// determine if this is a rough normal or not by checking how far off straight up it is
							vec3 halfVector = normalize( outgoing + sampleRec.direction );
							accumulatedRoughness += sin( acosApprox( halfVector.z ) );

							vec3 clearcoatHalfVector = normalize( clearcoatOutgoing + sampleRec.clearcoatDirection );
							accumulatedClearcoatRoughness += sin( acosApprox( clearcoatHalfVector.z ) );

							transmissiveRay = false;

						}

						// accumulate color
						gl_FragColor.rgb += ( emission * throughputColor );

						// skip the sample if our PDF or ray is impossible
						if ( sampleRec.pdf <= 0.0 || ! isDirectionValid( rayDirection, normal, faceNormal) ) {

							break;

						}

						throughputColor *= sampleRec.color / sampleRec.pdf;

						// attenuate the throughput color by the medium color
						if ( side == - 1.0 ) {

							throughputColor *= transmissionAttenuation( dist, surfaceRec.attenuationColor, surfaceRec.attenuationDistance );

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
