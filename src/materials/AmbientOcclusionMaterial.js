import { TangentSpaceNormalMap, Vector2 } from 'three';
import { MaterialBase } from './MaterialBase.js';
import { MeshBVHUniformStruct, shaderStructs, shaderIntersectFunction } from 'three-mesh-bvh';
import { shaderMaterialStructs } from '../shader/shaderStructs.js';
import { shaderUtils } from '../shader/shaderUtils.js';

export class AmbientOcclusionMaterial extends MaterialBase {

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

			throw new Error( 'AmbientOcclusionMaterial: Only tangent space normal map are supported' );

		}

	}

	constructor( parameters ) {

		super( {

			defines: {
				SAMPLES: 10,
			},

			uniforms: {
				bvh: { value: new MeshBVHUniformStruct() },
				radius: { value: 1.0 },
				seed: { value: 0 },

				normalMap: { value: null },
				normalScale: { value: new Vector2( 1, 1 ) },
			},

			vertexShader: /* glsl */`

				varying vec3 vNorm;
				varying vec3 vPos;

				#if defined(USE_NORMALMAP) && defined(USE_TANGENT)

					varying vec2 vUv;
					varying vec4 vTan;

				#endif

				void main() {

					vec4 mvPosition = vec4( position, 1.0 );
					mvPosition = modelViewMatrix * mvPosition;
					gl_Position = projectionMatrix * mvPosition;

					mat3 modelNormalMatrix = transpose( inverse( mat3( modelMatrix ) ) );
					vNorm = normalize( modelNormalMatrix * normal );
					vPos = ( modelMatrix * vec4( position, 1.0 ) ).xyz;

					#if defined(USE_NORMALMAP) && defined(USE_TANGENT)

						vUv = uv;
						vTan = tangent;

					#endif

				}

			`,

			fragmentShader: /* glsl */`
				#define RAY_OFFSET 1e-5

				precision highp isampler2D;
				precision highp usampler2D;
				precision highp sampler2DArray;
				#include <common>
				#include <cube_uv_reflection_fragment>

				${ shaderStructs }
				${ shaderIntersectFunction }
				${ shaderMaterialStructs }
				${ shaderUtils }

				uniform BVH bvh;
				uniform int seed;
				uniform float radius;

				varying vec3 vNorm;
				varying vec3 vPos;

				#if defined(USE_NORMALMAP) && defined(USE_TANGENT)

					uniform sampler2D normalMap;
					uniform vec2 normalScale;
					varying vec2 vUv;
					varying vec4 vTan;

				#endif

				void main() {

					rng_initialize( gl_FragCoord.xy, seed );

					// compute the flat face surface normal
					vec3 fdx = vec3( dFdx( vPos.x ), dFdx( vPos.y ), dFdx( vPos.z ) );
					vec3 fdy = vec3( dFdy( vPos.x ), dFdy( vPos.y ), dFdy( vPos.z ) );
					vec3 faceNormal = normalize( cross( fdx, fdy ) );

					// find the max component to scale the offset to account for floating point error
					vec3 absPoint = abs( vPos );
					float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
					vec3 normal = vNorm;

					#if defined(USE_NORMALMAP) && defined(USE_TANGENT)

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

					normal *= gl_FrontFacing ? 1.0 : - 1.0;

					vec3 rayOrigin = vPos + faceNormal * ( maxPoint + 1.0 ) * RAY_OFFSET;
					float accumulated = 0.0;
					for ( int i = 0; i < SAMPLES; i ++ ) {

						// sample the cosine weighted hemisphere and discard the sample if it's below
						// the geometric surface
						vec3 rayDirection = getHemisphereSample( normalize( normal ), rand4().xy );

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
								dist > radius
							)
						) {

							accumulated += 1.0;

						}

					}

					gl_FragColor.rgb = vec3( accumulated / float( SAMPLES ) );
					gl_FragColor.a = 1.0;

				}

			`

		} );

		this.setValues( parameters );

	}

}
