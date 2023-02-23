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

// material sampling
import { bsdfSamplingGLSL } from '../../shader/bsdf/bsdfSampling.glsl.js';

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
				FEATURE_RUSSIAN_ROULETTE: 1,
				FEATURE_DOF: 1,
				FEATURE_BACKGROUND_MAP: 0,
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

				// uniform structs
				${ cameraStructGLSL }
				${ lightsStructGLSL }
				${ equirectStructGLSL }
				${ materialStructGLSL }

				// common
				${ arraySamplerTexelFetchGLSL }
				${ fresnelGLSL }
				${ utilsGLSL }
				${ mathGLSL }
				${ intersectShapesGLSL }

				// sampling
				${ shapeSamplingGLSL }
				${ bsdfSamplingGLSL }
				${ equirectSamplingGLSL }
				${ lightSamplingGLSL }

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
					SampleRec sampleRec;
					int i;

					for ( i = 0; i < bounces; i ++ ) {

						sobolBounceIndex ++;

						bool hit = bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist );
						bool firstRay = i == 0 && transparentTraversals == transmissiveBounces;
						LightSampleRec lightHit = lightsClosestHit( lights.tex, lights.count, rayOrigin, rayDirection );

						if ( lightHit.hit && ( lightHit.dist < dist || ! hit ) ) {

							if ( firstRay || transmissiveRay ) {

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

							rayOrigin = stepRayOrigin( rayOrigin, rayDirection, - faceNormal, dist );

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
							clearcoatRoughness *= texture2D( textures, vec3( uvPrime.xy, material.clearcoatRoughnessMap ) ).g;

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
						surfaceRec.faceNormal = faceNormal;
						surfaceRec.normal = normal;

						surfaceRec.metalness = metalness;
						surfaceRec.color = albedo.rgb;
						surfaceRec.emission = emission;

						surfaceRec.ior = material.ior;
						surfaceRec.transmission = transmission;
						surfaceRec.thinFilm = material.thinFilm;
						surfaceRec.attenuationColor = material.attenuationColor;
						surfaceRec.attenuationDistance = material.attenuationDistance;

						surfaceRec.clearcoatNormal = clearcoatNormal;
						surfaceRec.clearcoat = clearcoat;

						surfaceRec.sheen = material.sheen;
						surfaceRec.sheenColor = sheenColor;

						surfaceRec.iridescence = iridescence;
						surfaceRec.iridescenceIor = material.iridescenceIor;
						surfaceRec.iridescenceThickness = iridescenceThickness;

						surfaceRec.specularColor = specularColor;
						surfaceRec.specularIntensity = specularIntensity;

						// apply perceptual roughness factor from gltf. sheen perceptual roughness is
						// applied by its brdf function
						// https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#microfacet-surfaces
						surfaceRec.roughness = roughness * roughness;
						surfaceRec.clearcoatRoughness = clearcoatRoughness * clearcoatRoughness;
						surfaceRec.sheenRoughness = sheenRoughness;

						// frontFace is used to determine transmissive properties and PDF. If no transmission is used
						// then we can just always assume this is a front face.
						surfaceRec.frontFace = side == 1.0 || transmission == 0.0;
						surfaceRec.eta = material.thinFilm || surfaceRec.frontFace ? 1.0 / material.ior : material.ior;
						surfaceRec.f0 = iorRatioToF0( surfaceRec.eta );

						// Compute the filtered roughness value to use during specular reflection computations.
						// The accumulated roughness value is scaled by a user setting and a "magic value" of 5.0.
						// If we're exiting something transmissive then scale the factor down significantly so we can retain
						// sharp internal reflections
						surfaceRec.filteredRoughness = applyFilteredGlossy( surfaceRec.roughness, accumulatedRoughness );
						surfaceRec.filteredClearcoatRoughness = applyFilteredGlossy( surfaceRec.clearcoatRoughness, accumulatedClearcoatRoughness );

						vec3 outgoing = - rayDirection;
						sampleRec = bsdfSample( outgoing, surfaceRec );

						bool wasBelowSurface = dot( rayDirection, faceNormal ) > 0.0;
						isShadowRay = sampleRec.specularPdf < sobol( 4 );

						vec3 prevRayDirection = rayDirection;
						rayDirection = sampleRec.worldDirection;

						bool isBelowSurface = dot( rayDirection, faceNormal ) < 0.0;
						rayOrigin = stepRayOrigin( rayOrigin, prevRayDirection, isBelowSurface ? - faceNormal : faceNormal, dist );

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
							vec3 attenuatedColor;
							if (
								lightSampleRec.pdf > 0.0 &&
								isDirectionValid( lightSampleRec.direction, normal, faceNormal ) &&
								! attenuateHit( bvh, rayOrigin, lightSampleRec.direction, lightSampleRec.dist, bounces - i, transparentTraversals, isShadowRay, attenuatedColor )
							) {

								// get the material pdf
								vec3 sampleColor;
								float lightMaterialPdf = bsdfResult( outgoing, lightSampleRec.direction, surfaceRec, sampleColor );
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
								isDirectionValid( envDirection, normal, faceNormal ) &&
								! attenuateHit( bvh, rayOrigin, envDirection, INFINITY, bounces - i, transparentTraversals, isShadowRay, attenuatedColor )
							) {

								// get the material pdf
								vec3 sampleColor;
								float envMaterialPdf = bsdfResult( outgoing, envDirection, surfaceRec, sampleColor );
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
							vec3 halfVector = normalize( outgoing + sampleRec.worldDirection );
							accumulatedRoughness += sin( acosApprox( dot( halfVector, normal ) ) );
							accumulatedClearcoatRoughness += sin( acosApprox( dot( halfVector, normal ) ) );

							transmissiveRay = false;

						}

						// if we're bouncing around the inside a transmissive material then decrement
						// perform this separate from a bounce
						bool isTransmissiveRay = dot( rayDirection, faceNormal * side ) < 0.0;
						if ( ( isTransmissiveRay || isBelowSurface ) && transparentTraversals > 0 ) {

							transparentTraversals --;
							i --;

						}

						// accumulate color
						gl_FragColor.rgb += ( emission * throughputColor );

						// skip the sample if our PDF or ray is impossible
						if ( sampleRec.pdf <= 0.0 || ! isDirectionValid( rayDirection, normal, faceNormal) ) {

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
