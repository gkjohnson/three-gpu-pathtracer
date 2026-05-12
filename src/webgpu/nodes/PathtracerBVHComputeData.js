import { BackSide, FrontSide, DoubleSide, BufferAttribute, BufferGeometry, StorageBufferAttribute, StructTypeNode, Vector4, SkinnedMesh, StructNode, RepeatWrapping, ClampToEdgeWrapping, MirroredRepeatWrapping, NearestFilter } from 'three/webgpu';
import { BVHComputeData, intersectionResultStruct, intersectsTriangle } from '../lib/BVHComputeData.js';
import { storage, float, uint, sampler, texture, EPSILON } from 'three/tsl';
import { SkinnedMeshBVH, MeshBVH, SAH } from 'three-mesh-bvh';
import { materialStruct } from './structs.wgsl.js';
import { getTextureHash } from '../../core/utils/sceneUpdateUtils.js';
import { bvhNodeBoundsStruct, bvhNodeStruct, rayStruct } from '../lib/wgsl/structs.wgsl.js';
import { wgslTagFn } from '../lib/nodes/WGSLTagFnNode.js';
import { SOBOL_INDEX_ALPHA_TEST, sobolFuncs } from './random.wgsl.js';
import { sampleTexelFunc } from './utils.wgsl.js';

const _colorVec = new Vector4();
const transformStruct = new StructTypeNode( {
	matrixWorld: 'mat4x4f',
	inverseMatrixWorld: 'mat4x4f',
	nodeOffset: 'uint',
	visible: 'uint',
	materialIndex: 'uint',
	_alignment0: 'uint',
	color: 'vec4f',
}, 'TransformStruct' );

// Pathtracer-specific version of the BVHComputeData tht includes material mapping, property structs
export class PathtracerBVHComputeData extends BVHComputeData {

	constructor( bvh, options = {} ) {

		// TODO: once supported we should use the appropriately-sized member sizes
		super( bvh, {
			attributes: {
				position: 'vec4f',
				normal: 'vec4f',
				tangent: 'vec4f',
				color: 'vec4f',
				uv: 'vec4f',
			},
			...options,
		} );

		this.structs.transform = transformStruct;
		this.structs.material = materialStruct;
		this.storage.materials = null;
		this.materials = [];
		this.bvhMap = new Map();

	}

	useTransparencyRaycastFn( textures ) {

		const texturesNode = texture( textures );
		const samplerNode = sampler( textures );

		const { prefix, storage, fns } = this;

		// raycast first hit
		const currentMaterial = uint( 0 ).toVar( 'bvh_material' );
		const scratchRayScalar = float( 1.0 ).toVar( 'bvh_rayScalar' );
		const baseOpacityScalar = float( 1.0 ).toVar( 'bvh_baseOpacity' );

		const options = {
			name: prefix + 'RaycastFirstHit',
			shapeStruct: rayStruct,
			resultStruct: intersectionResultStruct,

			boundsOrderFn: wgslTagFn/* wgsl */`
				fn getBoundsOrder( ray: ${ rayStruct }, splitAxis: u32, node: ${ bvhNodeStruct } ) -> bool {

					return ray.direction[ splitAxis ] >= 0.0;

				}
			`,
			intersectsBoundsFn: wgslTagFn/* wgsl */`
				fn rayIntersectsBounds( ray: ${ rayStruct }, bounds: ${ bvhNodeBoundsStruct }, result: ptr<function, ${ intersectionResultStruct }> ) -> u32 {

					// early-out if our object is completely transparent
					if ( ${ baseOpacityScalar } == 0.0 ) {

						return 0u;

					}

					let boundsMin = vec3( bounds.min[0], bounds.min[1], bounds.min[2] );
					let boundsMax = vec3( bounds.max[0], bounds.max[1], bounds.max[2] );

					let invDir = 1.0 / select(
						min( ray.direction, vec3f( -${ EPSILON } ) ),
						max( ray.direction, vec3f( ${ EPSILON } ) ),
						ray.direction >= vec3f( 0.0 ),
					);
					let tMinPlane = ( boundsMin - ray.origin ) * invDir;
					let tMaxPlane = ( boundsMax - ray.origin ) * invDir;

					let tMinHit = min( tMinPlane, tMaxPlane );
					let tMaxHit = max( tMinPlane, tMaxPlane );

					let t0 = max( max( tMinHit.x, tMinHit.y ), tMinHit.z );
					let t1 = min( min( tMaxHit.x, tMaxHit.y ), tMaxHit.z );

					let dist = max( t0, 0.0 );
					if ( t1 < dist ) {

						return 0u;

					} else if ( result.didHit && dist * ${ scratchRayScalar } >= result.dist ) {

						return 0u;

					} else {

						return 1u;

					}

				}

			`,
			intersectRangeFn: wgslTagFn/* wgsl */`
				fn intersectRange( ray: ${ rayStruct }, offset: u32, count: u32, result: ptr<function, ${ intersectionResultStruct }> ) -> bool {

					var didHit = false;
					for ( var ti = offset; ti < offset + count; ti = ti + 1u ) {

						let i0 = ${ storage.index }[ ti * 3u ];
						let i1 = ${ storage.index }[ ti * 3u + 1u ];
						let i2 = ${ storage.index }[ ti * 3u + 2u ];

						let a = ${ storage.attributes }[ i0 ].position.xyz;
						let b = ${ storage.attributes }[ i1 ].position.xyz;
						let c = ${ storage.attributes }[ i2 ].position.xyz;

						var triResult = ${ intersectsTriangle }( ray, a, b, c );
						triResult.dist *= ${ scratchRayScalar };
						if ( triResult.didHit && ( ! result.didHit || triResult.dist < result.dist ) ) {

							let material = ${ storage.materials }[ ${ currentMaterial } ];

							if ( material.transparent != 0 || material.alphaTest > 0.0 ) {


								var opacity = ${ baseOpacityScalar };

								// account for alpha component of albedo map
								if ( material.map != - 1 ) {

									let barycoord = triResult.barycoord;
									let a = ${ storage.attributes }[ i0 ].uv.xy;
									let b = ${ storage.attributes }[ i1 ].uv.xy;
									let c = ${ storage.attributes }[ i2 ].uv.xy;
									let uv = barycoord.x * a + barycoord.y * b + barycoord.z * c;
									let uvPrime = material.mapTransform * vec3f( uv, 1 );

									opacity *= ${ sampleTexelFunc }( ${ texturesNode }, ${ samplerNode }, uvPrime.xy, material.map, 0 ).a;

								}

								// account for green component of alpha map
								if ( material.alphaMap != - 1 ) {

									let barycoord = triResult.barycoord;
									let a = ${ storage.attributes }[ i0 ].uv.xy;
									let b = ${ storage.attributes }[ i1 ].uv.xy;
									let c = ${ storage.attributes }[ i2 ].uv.xy;
									let uv = barycoord.x * a + barycoord.y * b + barycoord.z * c;
									let uvPrime = material.alphaMapTransform * vec3f( uv, 1 );

									opacity *= ${ sampleTexelFunc }( ${ texturesNode }, ${ samplerNode }, uvPrime.xy, material.alphaMap, 0 ).g;

								}

								if ( material.transparent != 0 && opacity < ${ sobolFuncs[ 1 ] }( ${ SOBOL_INDEX_ALPHA_TEST } + ti ) ) {

									continue;

								}

								if ( opacity < material.alphaTest ) {

									continue;

								}

							}

							result.didHit = true;
							result.dist = triResult.dist;
							result.normal = triResult.normal;
							result.side = triResult.side;
							result.barycoord = triResult.barycoord;
							result.position = triResult.position;
							result.indices = vec4u( i0, i1, i2, ti );

							didHit = true;

						}

					}

					return didHit;

				}
			`,
			transformShapeFn: wgslTagFn/* wgsl */`
				fn transformRay( ray: ptr<function, ${ rayStruct }>, objectIndex: u32 ) -> void {

					${ currentMaterial } = ${ storage.transforms }[ objectIndex ].materialIndex;
					let toLocal = ${ storage.transforms }[ objectIndex ].inverseMatrixWorld;
					let isTransparent = ${ storage.materials }[ ${ currentMaterial } ].transparent;
					ray.origin = ( toLocal * vec4f( ray.origin, 1.0 ) ).xyz;
					ray.direction = ( toLocal * vec4f( ray.direction, 0.0 ) ).xyz;

					let len = length( ray.direction );
					ray.direction /= len;
					${ scratchRayScalar } = 1.0 / len;

					if ( isTransparent == 1 ) {

						${ baseOpacityScalar } = ${ storage.materials }[ ${ currentMaterial } ].opacity * ${ storage.transforms }[ objectIndex ].color.a;

					} else {

						${ baseOpacityScalar } = 1.0;

					}

				}
			`,
			transformResultFn: wgslTagFn/* wgsl */`
				fn transformResult( hit: ptr<function, ${ intersectionResultStruct }>, objectIndex: u32 ) -> void {

					let toLocal = ${ storage.transforms }[ objectIndex ].inverseMatrixWorld;
					hit.normal = normalize( ( transpose( toLocal ) * vec4f( hit.normal, 0.0 ) ).xyz );
					hit.position = ( ${ storage.transforms }[ objectIndex ].matrixWorld * vec4f( hit.position, 1.0 ) ).xyz;
					hit.objectIndex = objectIndex;

				}
			`,
		};

		fns.raycastFirstHit = this.getShapecastFn( options );
		options.name = prefix + 'RaycastAnyHit';
		options.anyHit = true;
		fns.raycastAnyHit = this.getShapecastFn( options );

	}

	update() {

		super.update();

		// build material storage
		const { materials, structs } = this;

		const { materialData, textures } = this.writeMaterialsBuffer( materials );

		this.textures = textures;

		const materialAttribute = new StorageBufferAttribute( materialData, structs.material.getLength() );
		const materialStorage = storage( materialAttribute, structs.material ).toReadOnly().setName( 'bvh_materials' );
		this.storage.materials = materialStorage;

		this.bvhMap.clear();
		this.materials.length = 0;

	}

	writeMaterialsBuffer( materials ) {

		function encodeTextureWrap( wrap ) {

			switch ( wrap ) {

				case RepeatWrapping:
					return 0;
				case ClampToEdgeWrapping:
					return 1;
				case MirroredRepeatWrapping:
					return 2;
				default:
					return 0;

			}

		}

		function getTexture( material, key ) {

			if ( key in material && material[ key ] ) {

				const texture = material[ key ];
				const hash = getTextureHash( texture );

				if ( ! textureLookUp.has( hash ) ) {

					textureLookUp.set( hash, textureLookUp.size );
					textures.push( texture );

				}

				const idx = textureLookUp.get( hash );
				const wrapS = encodeTextureWrap( texture.wrapS );
				const wrapT = encodeTextureWrap( texture.wrapT );
				const nearest = texture.magFilter === NearestFilter ? 1 : 0;
				return ( nearest << 28 ) | ( wrapT << 26 ) | ( wrapS << 24 ) | idx;

			} else {

				return - 1;

			}

		}

		function getField( material, key, def ) {

			return key in material ? material[ key ] : def;

		}

		function writeTextureMatrixToArray( material, textureKey, array, offset ) {

			const texture = material[ textureKey ] && material[ textureKey ].isTexture ? material[ textureKey ] : null;

			// check if texture exists
			if ( texture ) {

				if ( texture.matrixAutoUpdate ) {

					texture.updateMatrix();

				}

				const elements = texture.matrix.elements;

				// Both wgsl struct and elements should be in column-major format
				for ( let i = 0; i < 3; i ++ ) {

					array[ offset + 4 * i + 0 ] = elements[ 3 * i + 0 ];
					array[ offset + 4 * i + 1 ] = elements[ 3 * i + 1 ];
					array[ offset + 4 * i + 2 ] = elements[ 3 * i + 2 ];
					array[ offset + 4 * i + 3 ] = 0; // padding float

				}

			}

			return 12;

		}

		let index = 0;

		// Collect and index the list of textures based on shareable source
		const textureLookUp = new Map();
		const textures = [];

		// NOTE: make the minimum material buffer length 2 in order to avoid TSL converting it to a scalar
		// TODO: remove this when fixed in three
		const materialBufferLength = Math.max( materials.length, 2 );
		const floatArray = new Float32Array( materialBufferLength * this.structs.material.getLength() );
		const intArray = new Int32Array( floatArray.buffer );

		// TODO: make features work
		// features.reset();
		for ( let i = 0, l = materials.length; i < l; i ++ ) {

			const m = materials[ i ];

			// if ( m.isFogVolumeMaterial ) {
			//
			// 	// features.setUsed( 'FOG' );
			//
			// 	for ( let j = 0; j < MATERIAL_STRIDE; j ++ ) {
			//
			// 		floatArray[ index + j ] = 0;
			//
			// 	}
			//
			// 	// sample 0 .rgb
			// 	floatArray[ index + 0 * 4 + 0 ] = m.color.r;
			// 	floatArray[ index + 0 * 4 + 1 ] = m.color.g;
			// 	floatArray[ index + 0 * 4 + 2 ] = m.color.b;
			//
			// 	// sample 2 .a
			// 	floatArray[ index + 2 * 4 + 3 ] = getField( m, 'emissiveIntensity', 0.0 );
			//
			// 	// sample 3 .rgb
			// 	floatArray[ index + 3 * 4 + 0 ] = m.emissive.r;
			// 	floatArray[ index + 3 * 4 + 1 ] = m.emissive.g;
			// 	floatArray[ index + 3 * 4 + 2 ] = m.emissive.b;
			//
			// 	// sample 13 .g
			// 	// reusing opacity field
			// 	floatArray[ index + 13 * 4 + 1 ] = m.density;
			//
			// 	// side
			// 	floatArray[ index + 13 * 4 + 3 ] = 0.0;
			//
			// 	// sample 14 .b
			// 	floatArray[ index + 14 * 4 + 2 ] = 1 << 2;
			//
			// 	index += MATERIAL_STRIDE;
			// 	continue;
			//
			// }

			// color - offset 0
			floatArray[ index ++ ] = m.color.r;
			floatArray[ index ++ ] = m.color.g;
			floatArray[ index ++ ] = m.color.b;
			intArray[ index ++ ] = getTexture( m, 'map' );

			// metalness & roughness - offset 4
			floatArray[ index ++ ] = getField( m, 'metalness', 0.0 );
			intArray[ index ++ ] = getTexture( m, 'metalnessMap' );
			floatArray[ index ++ ] = getField( m, 'roughness', 0.0 );
			intArray[ index ++ ] = getTexture( m, 'roughnessMap' );

			// transmission & emissiveIntensity - offset 8
			// three.js assumes a default f0 of 0.04 if no ior is provided which equates to an ior of 1.5
			floatArray[ index ++ ] = getField( m, 'ior', 1.5 );
			floatArray[ index ++ ] = getField( m, 'transmission', 0.0 );
			intArray[ index ++ ] = getTexture( m, 'transmissionMap' );
			floatArray[ index ++ ] = getField( m, 'emissiveIntensity', 0.0 );

			// emission - offset 12
			if ( 'emissive' in m ) {

				floatArray[ index ++ ] = m.emissive.r;
				floatArray[ index ++ ] = m.emissive.g;
				floatArray[ index ++ ] = m.emissive.b;

			} else {

				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;

			}

			intArray[ index ++ ] = getTexture( m, 'emissiveMap' );

			// normals - offset 16
			intArray[ index ++ ] = getTexture( m, 'normalMap' );
			index ++; // because of vec2 alignment
			if ( 'normalScale' in m ) {

				floatArray[ index ++ ] = m.normalScale.x;
				floatArray[ index ++ ] = m.normalScale.y;

 			} else {

 				floatArray[ index ++ ] = 1;
 				floatArray[ index ++ ] = 1;

 			}

			// clearcoat - offset 20
			floatArray[ index ++ ] = getField( m, 'clearcoat', 0.0 );
			intArray[ index ++ ] = getTexture( m, 'clearcoatMap' );
			intArray[ index ++ ] = getTexture( m, 'clearcoatNormalMap' );
			index ++; // because of vec2 alignment

			// offset 24
			if ( 'clearcoatNormalScale' in m ) {

				floatArray[ index ++ ] = m.clearcoatNormalScale.x;
				floatArray[ index ++ ] = m.clearcoatNormalScale.y;

			} else {

				floatArray[ index ++ ] = 1;
				floatArray[ index ++ ] = 1;

			}

			floatArray[ index ++ ] = getField( m, 'clearcoatRoughness', 0.0 );
			intArray[ index ++ ] = getTexture( m, 'clearcoatRoughnessMap' );

			// iridescence - offset 28
			intArray[ index ++ ] = getTexture( m, 'iridescenceMap' );
			intArray[ index ++ ] = getTexture( m, 'iridescenceThicknessMap' );

			floatArray[ index ++ ] = getField( m, 'iridescence', 0.0 );
			floatArray[ index ++ ] = getField( m, 'iridescenceIOR', 1.3 );

			// offset 32
			const iridescenceThicknessRange = getField( m, 'iridescenceThicknessRange', [ 100, 400 ] );
			floatArray[ index ++ ] = iridescenceThicknessRange[ 0 ];
			floatArray[ index ++ ] = iridescenceThicknessRange[ 1 ];
			// vec3f alignment requirements
			index ++;
			index ++;

			// specular color - offset 36
			if ( 'specularColor' in m ) {

				floatArray[ index ++ ] = m.specularColor.r;
				floatArray[ index ++ ] = m.specularColor.g;
				floatArray[ index ++ ] = m.specularColor.b;

			} else {

				floatArray[ index ++ ] = 1.0;
				floatArray[ index ++ ] = 1.0;
				floatArray[ index ++ ] = 1.0;

			}

			intArray[ index ++ ] = getTexture( m, 'specularColorMap' );

			// specular intensity - offset 40
			floatArray[ index ++ ] = getField( m, 'specularIntensity', 1.0 );
			intArray[ index ++ ] = getTexture( m, 'specularIntensityMap' );

			// isThinFilm
			const isThinFilm = getField( m, 'thickness', 0.0 ) === 0.0 && getField( m, 'attenuationDistance', Infinity ) === Infinity;
			intArray[ index ++ ] = Number( isThinFilm );
			index ++;

			// attenuation - offset 44
			if ( 'attenuationColor' in m ) {

				floatArray[ index ++ ] = m.attenuationColor.r;
				floatArray[ index ++ ] = m.attenuationColor.g;
				floatArray[ index ++ ] = m.attenuationColor.b;

			} else {

				floatArray[ index ++ ] = 1.0;
				floatArray[ index ++ ] = 1.0;
				floatArray[ index ++ ] = 1.0;

			}

			floatArray[ index ++ ] = getField( m, 'attenuationDistance', Infinity );

			// alphaMap - offset 48
			intArray[ index ++ ] = getTexture( m, 'alphaMap' );
			intArray[ index ++ ] = Number( getField( m, 'castShadow', true ) ); // shadow
			floatArray[ index ++ ] = m.opacity;
			floatArray[ index ++ ] = m.alphaTest;

			// side & matte - offset 52
			if ( ! isThinFilm && m.transmission > 0.0 ) {

				floatArray[ index ++ ] = 0;

			} else {

				switch ( m.side ) {

					case FrontSide:
						floatArray[ index ++ ] = 1;
						break;
					case BackSide:
						floatArray[ index ++ ] = - 1;
						break;
					case DoubleSide:
						floatArray[ index ++ ] = 0;
						break;

				}

			}

			intArray[ index ++ ] = Number( getField( m, 'matte', false ) ); // matte
			floatArray[ index ++ ] = getField( m, 'sheen', 0.0 );
			index ++; // vec3 alignment requirements

			// sheenColor - offset 56
			if ( 'sheenColor' in m ) {

				floatArray[ index ++ ] = m.sheenColor.r;
				floatArray[ index ++ ] = m.sheenColor.g;
				floatArray[ index ++ ] = m.sheenColor.b;

			} else {

				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;

			}

			intArray[ index ++ ] = getTexture( m, 'sheenColorMap' );

			// sheenRoughness, flags - offset 60
			floatArray[ index ++ ] = getField( m, 'sheenRoughness', 0.0 );
			intArray[ index ++ ] = getTexture( m, 'sheenRoughnessMap' );

			intArray[ index ++ ] = Number( m.vertexColors );
			intArray[ index ++ ] = Number( m.flatShading );

			// transparent, fogVolume - offset 64
			intArray[ index ++ ] = Number( m.transparent );
			intArray[ index ++ ] = 0;
			index ++;
			index ++;

			// map transform - offset 68
			index += writeTextureMatrixToArray( m, 'map', floatArray, index );

			// metalnessMap transform - offset 80
			index += writeTextureMatrixToArray( m, 'metalnessMap', floatArray, index );

			// roughnessMap transform - offset 92
			index += writeTextureMatrixToArray( m, 'roughnessMap', floatArray, index );

			// transmissionMap transform - offset 104
			index += writeTextureMatrixToArray( m, 'transmissionMap', floatArray, index );

			// emissiveMap transform - offset 116
			index += writeTextureMatrixToArray( m, 'emissiveMap', floatArray, index );

			// normalMap transform - offset 128
			index += writeTextureMatrixToArray( m, 'normalMap', floatArray, index );

			// clearcoatMap transform - offset 140
			index += writeTextureMatrixToArray( m, 'clearcoatMap', floatArray, index );

			// clearcoatNormalMap transform - offset 152
			index += writeTextureMatrixToArray( m, 'clearcoatNormalMap', floatArray, index );

			// clearcoatRoughnessMap transform - offset 164
			index += writeTextureMatrixToArray( m, 'clearcoatRoughnessMap', floatArray, index );

			// sheenColorMap transform - offset 176
			index += writeTextureMatrixToArray( m, 'sheenColorMap', floatArray, index );

			// sheenRoughnessMap transform - offset 188
			index += writeTextureMatrixToArray( m, 'sheenRoughnessMap', floatArray, index );

			// iridescenceMap transform - offset 200
			index += writeTextureMatrixToArray( m, 'iridescenceMap', floatArray, index );

			// iridescenceThicknessMap transform - offset 212
			index += writeTextureMatrixToArray( m, 'iridescenceThicknessMap', floatArray, index );

			// specularColorMap transform - offset 224
			index += writeTextureMatrixToArray( m, 'specularColorMap', floatArray, index );

			// specularIntensityMap transform - offset 236
			index += writeTextureMatrixToArray( m, 'specularIntensityMap', floatArray, index );

			// alphaMap transform - offset 248
			index += writeTextureMatrixToArray( m, 'alphaMap', floatArray, index );

		}

		return { materialData: floatArray, textures };

	}

	writeTransformData( info, premultiplyMatrix, writeOffset, targetBuffer ) {

		super.writeTransformData( info, premultiplyMatrix, writeOffset, targetBuffer );

		// write material data to the transforms
		const { materials } = this;
		const { object, instanceId, root } = info;

		// get the material associated with the bvh group
		let material = object.material;
		if ( Array.isArray( material ) ) {

			const { materialIndex } = object.geometry.groups[ root ];
			material = material[ materialIndex ];

		}

		// save the index
		let index = materials.indexOf( material );
		if ( index === - 1 ) {

			index = materials.length;
			materials.push( material );

		}

		const transformBufferU32 = new Uint32Array( targetBuffer );
		transformBufferU32[ writeOffset * transformStruct.getLength() + 34 ] = index;

		// write color
		// TODO: note that both BatchedMesh and InstancedMesh "getColorAt" functions throw
		// if colors have not been defined.
		if ( object.isInstancedMesh && object.instanceColor ) {

			object.getColorAt( instanceId, _colorVec );
			_colorVec.w = 1.0;

		} else if ( object.isBatchedMesh && object._colorsTexture ) {

			object.getColorAt( instanceId, _colorVec );

		} else {

			_colorVec.setScalar( 1 );

		}

		const transformBufferF32 = new Float32Array( targetBuffer );
		_colorVec.toArray( transformBufferF32, writeOffset * transformStruct.getLength() + 36 );

	}

	getBVH( object, instanceId, rangeTarget ) {

		const { bvhMap } = this;
		const bvh = super.getBVH( object, instanceId, rangeTarget );
		if ( bvhMap.has( bvh ) ) {

			const data = bvhMap.get( bvh );
			Object.assign( rangeTarget, data.range );

			// make sure the mesh and bvh are updated if it's being reused across updates
			if ( bvh !== data.bvh && bvh instanceof SkinnedMeshBVH ) {

				const sourceMesh = bvh.mesh;
				const clonedMesh = data.bvh.mesh;
				clonedMesh.matrixWorld
					.copy( sourceMesh.matrixWorld )
					.decompose( clonedMesh.position, clonedMesh.quaternion, clonedMesh.scale );

				bvh.refit();

			}

			return data.bvh;

		} else if ( bvh.indirect ) {

			// "indirect" bvhs are not supported since they cannot be unpacked in a way tht will allow for coherent material indices
			const proxyGeometry = new BufferGeometry();
			proxyGeometry.attributes = bvh.geometry.attributes;

			let array;
			if ( bvh.geometry.index ) {

				array = bvh.geometry.index.array.slice( rangeTarget.start, rangeTarget.count + rangeTarget.start );

			} else {

				const { start, count } = rangeTarget;
				array = new Uint32Array( count );
				for ( let i = 0, l = rangeTarget.count; i < l; i ++ ) {

					array[ i ] = start + i;

				}

			}

			proxyGeometry.index = new BufferAttribute( array, 1 );
			rangeTarget.start = 0;

			let newBVH;
			if ( bvh instanceof SkinnedMeshBVH ) {

				const sourceMesh = bvh.mesh;
				const clonedMesh = new SkinnedMesh( proxyGeometry );
				clonedMesh.copy( sourceMesh );
				clonedMesh.matrixWorld
					.copy( sourceMesh.matrixWorld )
					.decompose( clonedMesh.position, clonedMesh.quaternion, clonedMesh.scale );

				newBVH = new SkinnedMeshBVH( clonedMesh, { strategy: SAH, maxLeafSize: 5 } );

			} else {

				newBVH = new MeshBVH( proxyGeometry, { strategy: SAH, maxLeafSize: 5 } );

			}

			bvhMap.set( bvh, { bvh: newBVH, range: { ...rangeTarget } } );
			return newBVH;

		} else {

			return bvh;

		}

	}

}
