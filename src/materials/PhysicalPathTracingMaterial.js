import { Matrix4, Matrix3, Color } from 'three';
import { MaterialBase } from './MaterialBase.js';
import {
	MeshBVHUniformStruct, FloatVertexAttributeTexture, UIntVertexAttributeTexture,
	shaderStructs, shaderIntersectFunction,
} from 'three-mesh-bvh';
import { shaderMaterialStructs } from '../shader/shaderStructs.js';
import { MaterialStructArrayUniform } from '../uniforms/MaterialStructArrayUniform.js';
import { RenderTarget2DArray } from '../uniforms/RenderTarget2DArray.js';
import { shaderMaterialSampling } from '../shader/shaderMaterialSampling.js';
import { shaderUtils } from '../shader/shaderUtils.js';
import { PhysicalCameraUniform } from '../uniforms/PhysicalCameraUniform.js';

export class PhysicalPathTracingMaterial extends MaterialBase {

	// three.js relies on this field to add env map functions and defines
	get envMap() {

		return this.environmentMap;

	}

	constructor( parameters ) {

		super( {

			transparent: true,
			depthWrite: false,

			defines: {
				DOF_SUPPORT: 1,
				TRANSPARENT_TRAVERSALS: 5,
				MATERIAL_LENGTH: 0,
				GRADIENT_BG: 0,
			},

			uniforms: {
				bounces: { value: 3 },
				physicalCamera: { value: new PhysicalCameraUniform() },

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
				environmentRotation: { value: new Matrix3() },
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
				#define RAY_OFFSET 1e-4

				precision highp isampler2D;
				precision highp usampler2D;
				precision highp sampler2DArray;
				vec4 envMapTexelToLinear( vec4 a ) { return a; }
				#include <common>
				#include <cube_uv_reflection_fragment>

				${ shaderStructs }
				${ shaderIntersectFunction }
				${ shaderMaterialStructs }

				${ shaderUtils }
				${ shaderMaterialSampling }

				#ifdef USE_ENVMAP

				uniform float environmentBlur;
				uniform sampler2D environmentMap;
				uniform mat3 environmentRotation;

				#else

				uniform vec3 gradientTop;
				uniform vec3 gradientBottom;

				#endif

				#if GRADIENT_BG

				uniform vec3 bgGradientTop;
				uniform vec3 bgGradientBottom;

				#endif

				#if DOF_SUPPORT

				uniform PhysicalCamera physicalCamera;

				#endif

				uniform int bounces;

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

				vec3 sampleEnvironment( vec3 direction ) {

					#ifdef USE_ENVMAP

					vec3 skyColor = textureCubeUV( environmentMap, environmentRotation * direction, environmentBlur ).rgb;

					#else

					direction = normalize( direction );
					float value = ( direction.y + 1.0 ) / 2.0;
					vec3 skyColor = mix( gradientBottom, gradientTop, value );

					#endif

					return skyColor * environmentIntensity;

				}

				vec3 sampleBackground( vec3 direction ) {

					#if GRADIENT_BG

					direction = normalize( direction + randDirection() * 0.05 );
					float value = ( direction.y + 1.0 ) / 2.0;

					value = pow( value, 2.0 );

					return mix( bgGradientBottom, bgGradientTop, value );

					#else

					return sampleEnvironment( direction );

					#endif

				}

				void main() {

					rng_initialize( gl_FragCoord.xy, seed );

					// get [-1, 1] normalized device coordinates
					vec2 ndc = 2.0 * vUv - vec2( 1.0 );
					vec3 rayOrigin, rayDirection;
					ndcToCameraRay( ndc, cameraWorldMatrix, invProjectionMatrix, rayOrigin, rayDirection );

					#if DOF_SUPPORT

					// depth of field
					vec3 focalPoint = rayOrigin + normalize( rayDirection ) * physicalCamera.focusDistance;

					// get the aperture sample
					vec2 apertureSample = sampleAperture( physicalCamera.apertureBlades ) * physicalCamera.bokehSize * 0.5 * 1e-3;

					// rotate the aperture shape
					float ac = cos( physicalCamera.apertureRotation );
					float as = sin( physicalCamera.apertureRotation );
					apertureSample = vec2(
						apertureSample.x * ac - apertureSample.y * as,
						apertureSample.x * as + apertureSample.y * ac
					);
					apertureSample.x *= saturate( physicalCamera.anamorphicRatio );
					apertureSample.y *= saturate( 1.0 / physicalCamera.anamorphicRatio );

					#endif

					// create the new ray
					rayOrigin += ( cameraWorldMatrix * vec4( apertureSample, 0.0, 0.0 ) ).xyz;
					rayDirection = focalPoint - rayOrigin;

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
					for ( i = 0; i < bounces; i ++ ) {

						if ( ! bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist ) ) {

							if ( i == 0 ) {

								gl_FragColor = vec4( sampleBackground( rayDirection ), 1.0 );

							} else {

								gl_FragColor += vec4( sampleEnvironment( rayDirection ) * throughputColor, 1.0 );

							}
							break;

						}

						uint materialIndex = uTexelFetch1D( materialIndexAttribute, faceIndices.x ).r;
						Material material = materials[ materialIndex ];

						if ( material.matte ) {

							gl_FragColor = vec4( sampleEnvironment( rayDirection ), 1.0 );
							break;

						}

						vec2 uv = textureSampleBarycoord( uvAttribute, barycoord, faceIndices.xyz ).xy;

						// albedo
						vec4 albedo = vec4( material.color, material.opacity );
						if ( material.map != - 1 ) {

							albedo *= texture2D( textures, vec3( uv, material.map ) );

						}

						// possibly skip this sample if it's transparent, alpha test is enabled, or we hit the wrong material side
						// and it's single sided.
						// - alpha test is disabled when it === 0
						// - the material sidedness test is complicated because we want light to pass through the back side but still
						// be able to see the front side. This boolean checks if the side we hit is the front side on the first ray
						// and we're rendering the other then we skip it. Do the opposite on subsequent bounces to get incoming light.
						float alphaTest = material.alphaTest;
						bool useAlphaTest = alphaTest != 0.0;
						bool isFirstHit = i == 0;
						if (
							// material sidedness
							material.side != 0.0 && ( side != material.side ) == isFirstHit

							// alpha test
							|| useAlphaTest && albedo.a < alphaTest

							// opacity
							|| ! useAlphaTest && albedo.a < rand()
						) {

							vec3 point = rayOrigin + rayDirection * dist;
							rayOrigin += rayDirection * dist - faceNormal * RAY_OFFSET;

							// only allow a limited number of transparency discards otherwise we could
							// crash the context with too long a loop.
							i -= sign( transparentTraversals );
							transparentTraversals -= sign( transparentTraversals );
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

							roughness *= texture2D( textures, vec3( uv, material.roughnessMap ) ).g;

						}

						// metalness
						float metalness = material.metalness;
						if ( material.metalnessMap != - 1 ) {

							metalness *= texture2D( textures, vec3( uv, material.metalnessMap ) ).b;

						}

						// emission
						vec3 emission = material.emissiveIntensity * material.emissive;
						if ( material.emissiveMap != - 1 ) {

							emission *= texture2D( textures, vec3( uv, material.emissiveMap ) ).xyz;

						}

						// transmission
						float transmission = material.transmission;
						if ( material.transmissionMap != - 1 ) {

							transmission *= texture2D( textures, vec3( uv, material.transmissionMap ) ).r;

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

						SurfaceRec surfaceRec;
						surfaceRec.normal = normal;
						surfaceRec.faceNormal = faceNormal;
						surfaceRec.transmission = transmission;
						surfaceRec.ior = material.ior;
						surfaceRec.emission = emission;
						surfaceRec.metalness = metalness;
						surfaceRec.color = albedo.rgb;
						surfaceRec.roughness = roughness;

						// frontFace is used to determine transmissive properties and PDF. If no transmission is used
						// then we can just always assume this is a front face.
						surfaceRec.frontFace = side == 1.0 || transmission == 0.0;

						// Compute the filtered roughness value to use during specular reflection computations. A minimum
						// value of 1e-6 is needed because the GGX functions do not work with a roughness value of 0 and
						// the accumulated roughness value is scaled by a user setting and a "magic value" of 5.0.
						// If we're exiting something transmissive then scale the factor down significantly so we can retain
						// sharp internal reflections
						surfaceRec.filteredRoughness = clamp(
							max( surfaceRec.roughness, accumulatedRoughness * filterGlossyFactor * 5.0 ),
							1e-3,
							1.0
						);

						mat3 normalBasis = getBasisFromNormal( surfaceRec.normal );
						mat3 invBasis = inverse( normalBasis );

						vec3 outgoing = - normalize( invBasis * rayDirection );
						SampleRec sampleRec = bsdfSample( outgoing, surfaceRec );

						// adjust the hit point by the surface normal by a factor of some offset and the
						// maximum component-wise value of the current point to accommodate floating point
						// error as values increase.
						vec3 point = rayOrigin + rayDirection * dist;
						vec3 absPoint = abs( point );
						float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
						rayDirection = normalize( normalBasis * sampleRec.direction );

						bool isBelowSurface = dot( rayDirection, faceNormal ) < 0.0;
						rayOrigin = point + faceNormal * ( maxPoint + 1.0 ) * ( isBelowSurface ? - RAY_OFFSET : RAY_OFFSET );

						// accumulate a roughness value to offset diffuse, specular, diffuse rays that have high contribution
						// to a single pixel resulting in fireflies
						if ( ! isBelowSurface ) {

							// determine if this is a rough normal or not by checking how far off straight up it is
							vec3 halfVector = normalize( outgoing + sampleRec.direction );
							accumulatedRoughness += sin( acos( halfVector.z ) );

						}

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

		this.setValues( parameters );

	}

}
