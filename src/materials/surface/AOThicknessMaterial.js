import { TangentSpaceNormalMap, Vector2, Matrix4 } from 'three'; import { MaterialBase } from '../MaterialBase.js';
import { MeshBVHUniformStruct, BVHShaderGLSL } from 'three-mesh-bvh';
import { MATERIAL_PIXELS } from '../../uniforms/MaterialsTexture.js';

import * as StructsGLSL from '../../shader/structs/index.js';
import * as SamplingGLSL from '../../shader/sampling/index.js';
import * as RandomGLSL from '../../shader/rand/index.js';
import * as CommonGLSL from '../../shader/common/index.js';

export const AOThicknessMode = {
	AO_AND_THICKNESS: 1,
	AO_ONLY: 2
};

export class AOThicknessMaterial extends MaterialBase {

	get normalMap() {

		return this.uniforms.normalMap.value;

	}

	set normalMap( v ) {

		this.uniforms.normalMap.value = v;
		this.setDefine( 'USE_NORMALMAP', v ? null : '' );

	}

	get normalMapType() {

		return TangentSpaceNormalMap;

	}

	set normalMapType( v ) {

		if ( v !== TangentSpaceNormalMap ) {

			throw new Error( 'AOThicknessMaterial: Only tangent space normal map are supported' );

		}

	}

	constructor( parameters ) {

		super( {
			defines: {
				SAMPLES: 1,
				MATERIAL_PIXELS: MATERIAL_PIXELS
			},

			uniforms: {
				bvh: { value: new MeshBVHUniformStruct() },
				aoRadius: { value: 1.0 },
				thicknessRadius: { value: 1.0 },
				seed: { value: 0 },
				resolution: { value: new Vector2() },

				normalMap: { value: null },
				normalScale: { value: new Vector2( 1, 1 ) },

				// Used for baking
				uvToTriangleMap: { value: null },
				objectModelMatrix: { value: new Matrix4() },
			},

			vertexShader: /* glsl */`

				#if ! defined( USE_UV_TRIANGLE_MAP )

					varying vec3 vNorm;
					varying vec3 vPos;

					#if defined( USE_NORMALMAP ) && defined( USE_TANGENT )

						varying vec4 vTan;

					#endif

				#endif

				varying vec2 vUv;

				void main() {

					vec4 mvPosition = vec4( position, 1.0 );
					mvPosition = modelViewMatrix * mvPosition;
					gl_Position = projectionMatrix * mvPosition;

					#if defined( USE_UV_TRIANGLE_MAP )

						vUv = uv;

					#else

						mat3 modelNormalMatrix = transpose( inverse( mat3( modelMatrix ) ) );
						vNorm = normalize( modelNormalMatrix * normal );
						vPos = ( modelMatrix * vec4( position, 1.0 ) ).xyz;

						#if defined( USE_NORMALMAP ) && defined( USE_TANGENT )

							vUv = uv;
							vTan = tangent;

						#endif

					#endif

				}

			`,

			fragmentShader: /* glsl */`
				#define RAY_OFFSET 1e-4

				precision highp isampler2D;
				precision highp usampler2D;
				precision highp sampler2DArray;
				precision highp sampler2D;
				#include <common>
				#include <cube_uv_reflection_fragment>

				// bvh
				${ BVHShaderGLSL.common_functions }
				${ BVHShaderGLSL.bvh_struct_definitions }
				${ BVHShaderGLSL.bvh_ray_functions }

				// uniform structs
				${ StructsGLSL.material_struct }

				// random
				${ RandomGLSL.pcg_functions }
				#define rand(v) pcgRand()
				#define rand2(v) pcgRand2()
				#define rand3(v) pcgRand3()
				#define rand4(v) pcgRand4()

				// common
				${ SamplingGLSL.shape_sampling_functions }
				${ CommonGLSL.util_functions }

				uniform BVH bvh;
				uniform sampler2D uvToTriangleMap;
				uniform int seed;
				uniform float aoRadius;
				uniform float thicknessRadius;

				uniform vec2 resolution;

				#if defined( USE_UV_TRIANGLE_MAP )

					uniform mat4 objectModelMatrix;
					varying vec2 vUv;

				#else

					varying vec3 vNorm;
					varying vec3 vPos;

					#if defined( USE_NORMALMAP ) && defined( USE_TANGENT )

						uniform sampler2D normalMap;
						uniform vec2 normalScale;
						varying vec2 vUv;
						varying vec4 vTan;

					#endif

				#endif


				float accumulateOcclusion(vec3 pos, vec3 normal, float radius) {
					float accumulated = 0.0;
					vec3 faceNormal;

					// find the max component to scale the offset to account for floating point error
					vec3 absPoint = abs( pos );
					float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );

					#if defined( USE_UV_TRIANGLE_MAP )

						faceNormal = normal;

					#else

						vec3 fdx = vec3( dFdx( pos.x ), dFdx( pos.y ), dFdx( pos.z ) );
						vec3 fdy = vec3( dFdy( pos.x ), dFdy( pos.y ), dFdy( pos.z ) );
						faceNormal = normalize( cross( fdx, fdy ) );

						#if defined( USE_NORMALMAP ) && defined( USE_TANGENT )

							// some provided tangents can be malformed (0, 0, 0) causing the normal to be degenerate
							// resulting in NaNs and slow path tracing.
							if ( length( vTan.xyz ) > 0.0 ) {

								vec2 uv = vUv;
								vec3 tangent = normalize( vTan.xyz );
								vec3 bitangent = normalize( cross( normal, tangent ) * vTan.w );
								mat3 vTBN = mat3( tangent, bitangent, normal );

								vec3 texNormal = texture2D( normalMap, uv ).xyz * 2.0 - 1.0;
								texNormal.xy *= normalScale;
								normal = vTBN * texNormal;

							}

						#endif
					#endif

					normal *= gl_FrontFacing ? 1.0 : - 1.0;

					vec3 rayOrigin = pos + faceNormal * ( maxPoint + 1.0 ) * RAY_OFFSET;
					for ( int i = 0; i < SAMPLES; i ++ ) {

						// sample the cosine weighted hemisphere and discard the sample if it's below
						// the geometric surface
						vec3 rayDirection = sampleHemisphere( normalize( normal ), pcgRand4().xy );

						// check if we hit the mesh and its within the specified radius
						float side = 1.0;
						float dist = 0.0;
						vec3 barycoord = vec3( 0.0 );
						vec3 outNormal = vec3( 0.0 );
						uvec4 faceIndices = uvec4( 0u );

						// if the ray is above the geometry surface, and it doesn't hit another surface within the specified radius then
						// we consider it lit
						if (
							dot( rayDirection, faceNormal ) > 0.0 &&
							(
								! bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, outNormal, barycoord, side, dist ) ||
								dist >= radius
							)
						) {

							accumulated += 1.0;

						}

					}

					return accumulated;
				}

				vec2 getUVTexelCoord(vec2 uv, vec2 texelSize, int offset) {
						return uv + (vec2(offset, 0) * texelSize);
				}

				void main() {

					float accumulated = 0.0;
					rng_initialize( gl_FragCoord.xy, seed );
					vec3 pos;
					vec3 norm;

					#if defined( USE_UV_TRIANGLE_MAP )
						mat3 modelNormalMatrix = transpose( inverse( mat3( objectModelMatrix ) ) );
						ivec2 posUv = ivec2(vUv * resolution - (0.5 / resolution));
						ivec2 normUv = posUv;
						normUv.y += int(resolution.y);

						vec4 posTexel = texelFetch( uvToTriangleMap, posUv, 0);
						pos = posTexel.rgb;
						norm = texelFetch( uvToTriangleMap, normUv, 0 ).rgb;

						pos = (objectModelMatrix * vec4( pos, 1.0 )).xyz;
						norm = normalize( modelNormalMatrix * norm);
						gl_FragColor.a = posTexel.a;

					#else

						pos = vPos;
						norm = vNorm;
						gl_FragColor.a = 1.0;


					#endif

					float ao = accumulateOcclusion( pos, norm, aoRadius );

					#if defined ( GENERATE_THICKNESS )

						float thickness = accumulateOcclusion( pos, - norm, thicknessRadius );

						gl_FragColor.r = ao / float( SAMPLES );
						gl_FragColor.g = thickness / float( SAMPLES );
						gl_FragColor.b = 0.0;

					#else

						gl_FragColor.rgb = vec3( ao / float( SAMPLES ) );

					#endif
				}

			`

		} );

		if ( parameters.uvToTriangleMap ) {

			this.setDefine( 'USE_UV_TRIANGLE_MAP', '' );

		}

		if ( parameters.mode !== AOThicknessMode.AO_ONLY ) {

			this.setDefine( 'GENERATE_THICKNESS', '' );

		}

		delete parameters.mode;

		this.setValues( parameters );

	}

}
