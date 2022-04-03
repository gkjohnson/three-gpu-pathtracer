import { Matrix4, Color } from 'three';
import { MaterialBase } from './MaterialBase.js';
import {
	MeshBVHUniformStruct, FloatVertexAttributeTexture, UIntVertexAttributeTexture,
	shaderStructs, shaderIntersectFunction,
} from 'three-mesh-bvh';
import { shaderMaterialStructs } from '../shader/shaderStructs.js';
import { shaderUtils } from '../shader/shaderUtils.js';
import { MaterialStructArrayUniform } from '../uniforms/MaterialStructArrayUniform.js';
import { RenderTarget2DArray } from '../uniforms/RenderTarget2DArray.js';

export class LambertPathTracingMaterial extends MaterialBase {

	// three.js relies on this field to add env map functions and defines
	get envMap() {

		return this.environmentMap;

	}

	constructor( parameters ) {

		super( {

			transparent: true,
			depthWrite: false,

			defines: {
				BOUNCES: 3,
				MATERIAL_LENGTH: 0,
				GRADIENT_BG: 0,
				DISPLAY_FLOOR: 1,
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
				${ shaderUtils }

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
					int i;
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

						if ( material.opacity < rand() ) {

							vec3 point = rayOrigin + rayDirection * dist;
							rayOrigin += rayDirection * dist - faceNormal * RAY_OFFSET;
							throughputColor *= mix( vec3( 1.0 ), material.color, 0.5 * material.opacity );

							i --;
							continue;

						}

						// fetch the interpolated smooth normal
						vec3 normal = normalize( textureSampleBarycoord(
							normalAttribute,
							barycoord,
							faceIndices.xyz
						).xyz );

						vec2 uv = textureSampleBarycoord( uvAttribute, barycoord, faceIndices.xyz ).xy;

						// emission
						vec3 emission = material.emissiveIntensity * material.emissive;
						if ( material.emissiveMap != - 1 ) {

							emission *= texture2D( textures, vec3( uv, material.emissiveMap ) ).xyz;

						}

						gl_FragColor.rgb += throughputColor * emission * max( side, 0.0 );

						// 1 / PI attenuation for physically correct lambert model
						// https://www.rorydriscoll.com/2009/01/25/energy-conservation-in-games/
						throughputColor *= 1.0 / PI;

						// albedo
						throughputColor *= material.color;
						if ( material.map != - 1 ) {

							throughputColor *= texture2D( textures, vec3( uv, material.map ) ).xyz;

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

						// adjust the hit point by the surface normal by a factor of some offset and the
						// maximum component-wise value of the current point to accommodate floating point
						// error as values increase.
						vec3 point = rayOrigin + rayDirection * dist;
						vec3 absPoint = abs( point );
						float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
						rayOrigin = point + faceNormal * ( maxPoint + 1.0 ) * RAY_OFFSET;
						rayDirection = getHemisphereSample( normal, rand2() );

						// if the surface normal is skewed such that the outgoing vector can wind up underneath
						// the triangle surface then just consider it absorbed.
						if ( dot( rayDirection, faceNormal ) < 0.0 ) {

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
