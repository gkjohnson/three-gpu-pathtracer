import { BufferAttribute, BufferGeometry, StructTypeNode, Vector4, SkinnedMesh } from 'three/webgpu';
import { BVHComputeData, intersectRayTriangle, bvhNodeBoundsStruct, bvhNodeStruct, rayStruct, wgslTagFn, contextProxy, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { float, uint } from 'three/tsl';
import { SkinnedMeshBVH, MeshBVH, SAH, NOT_INTERSECTED, INTERSECTED, STOP_TRAVERSAL } from 'three-mesh-bvh';
import { materialExtinctionFn, fogShadowDistanceFn } from './medium.wgsl.js';

const _colorVec = new Vector4();
const transformStruct = new StructTypeNode( {
	matrixWorld: 'mat4x4f',
	inverseMatrixWorld: 'mat4x4f',
	visible: 'uint',
	materialIndex: 'uint',
	visibleToShadowRays: 'uint',

	// the slot the medium stack holds for the volume this slot bounds: the first of the object's bvh groups
	// with the same material, so a path enters and leaves the volume through any of them
	mediumId: 'uint',
	color: 'vec4f',
}, 'TransformStruct' );

// three-mesh-bvh's ray hit result. Shadow rays also record the share of bsdf rays the faces they skipped
// would stop, the share of light the partially transparent surfaces they passed block, and the optical
// depth of the fog volume boundaries they passed
const intersectionResultStruct = new StructTypeNode( {
	indices: 'vec4u',
	normal: 'vec3f',
	didHit: 'bool',
	barycoord: 'vec3f',
	objectIndex: 'uint',
	fogDepth: 'vec3f',
	side: 'float',
	dist: 'float',
	skippedOcclusion: 'float',
	occlusion: 'float',
}, 'PathTracerIntersectionResult' );

// Pathtracer-specific version of the BVHComputeData tht includes material mapping, property structs
export class PathtracerBVHComputeData extends BVHComputeData {

	constructor( bvh, shadingModel, options = {} ) {

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

		// the shading model owns the materials, the traversal reads them through the node context
		this.shadingModel = shadingModel;
		this.structs.transform = transformStruct;
		this.bvhMap = new Map();

		// each volume's medium id
		this._mediumIds = new Map();

	}

	updateUvAttributesFromScene() {

		const { attributes } = this;
		const keys = new Set( [ 'color' ] );
		for ( let i = 0; i < 8; i ++ ) {

			const key = i === 0 ? 'uv' : 'uv' + i;
			delete attributes[ key ];
			keys.add( key );

		}

		this.getRootObject().traverse( c => {

			if ( c.geometry ) {

				for ( const key in c.geometry.attributes ) {

					if ( keys.has( key ) ) {

						attributes[ key ] = 'vec4f';

					}

				}

			}

		} );

	}

	updateUvSampleFunction() {

		// TODO: eventually it may be best to pack the uvs into an array in the
		// attribute struct so they can be sampled via array index but TSL structs
		// make this difficult at the moment. It may break down when a uv channel
		// unused, as well.
		const { structs, fns } = this;

		// generate the switch cases for the uv channels
		const cases = [];
		let fallback = null;
		structs.attributes.membersLayout.forEach( ( { name } ) => {

			if ( /^uv/.test( name ) ) {

				const channel = name === 'uv' ? 0 : Number( name.replace( /^uv/, '' ) );
				cases.push( /* wgsl */`
					case ${ channel }u: {

						return vertexData.${ name }.xy;

					}
				` );

				if ( fallback === null ) {

					fallback = `vertexData.${ name }.xy`;

				}

			}

		} );

		fns.getUvFromChannel = wgslTagFn/* wgsl */`
			fn getUvFromChannel( vertexData: ${ structs.attributes }, packed: i32 ) -> vec2f {

				// the uv channel is packed into bits 23-25 of the "*Map" descriptor
				let channel = u32( ( packed >> 23 ) & 0x7 );
				switch ( channel ) {

					${ cases.join( '\n' ) }
					default: {

						return ${ fallback ?? 'vec2f( 0.0 )' };

					}

				}

			}
		`;

	}

	updateColorSampleFn() {

		// create a function for retrieving the color from the vertex data instance. If the struct does not include
		// color then return white.
		const { structs, fns } = this;
		const hasColor = Boolean( structs.attributes.membersLayout.find( ( { name } ) => name === 'color' ) );
		if ( hasColor ) {

			fns.getColor = wgslTagFn/* wgsl */`
				fn getColor( vertexData: ${ structs.attributes } ) -> vec4f {

					return vertexData.color;

				}
			`;

		} else {

			fns.getColor = wgslTagFn/* wgsl */`
				fn getColor( vertexData: ${ structs.attributes } ) -> vec4f {

					return vec4f( 1.0 );

				}
			`;

		}

	}

	useTransparencyRaycastFn() {

		const { storage, fns } = this;

		// the shading model owns the textures. Its surface shading reads the same "sampleTexel", so both
		// resolve to one texture info binding per pipeline
		const sampleTexel = contextProxyFn( 'shadingModel.fns.sampleTexel' );
		const materialsStorage = contextProxy( 'shadingModel.storage.materials' );

		// the object being traversed, set when the ray is transformed into its space
		const currentObjectIndex = uint().toVar( 'bvh_objectIndex' );
		const scratchRayScalar = float( 1.0 ).toVar( 'bvh_rayScalar' );
		const baseOpacityScalar = float( 1.0 ).toVar( 'bvh_baseOpacity' );

		// the opacity of a hit triangle at its barycentric coordinate, from the object's opacity, the vertex
		// colors and the alpha of the map and alpha map
		const getHitOpacity = wgslTagFn/* wgsl */`
			fn getHitOpacity( material: ${ contextProxy( 'shadingModel.structs.material' ) }, i0: u32, i1: u32, i2: u32, barycoord: vec3f ) -> f32 {

				var opacity = ${ baseOpacityScalar };
				if ( material.transparent != 0 || material.alphaTest > 0.0 ) {

					// add support for vertex color opacity
					if ( material.vertexColors == 1 ) {

						let a = ${ fns.getColor }( ${ storage.attributes }[ i0 ] );
						let b = ${ fns.getColor }( ${ storage.attributes }[ i1 ] );
						let c = ${ fns.getColor }( ${ storage.attributes }[ i2 ] );
						let col = barycoord.x * a + barycoord.y * b + barycoord.z * c;

						opacity *= col.a;

					}

					// account for alpha component of albedo map
					if ( material.map != - 1 ) {

						let a = ${ fns.getUvFromChannel }( ${ storage.attributes }[ i0 ], material.map );
						let b = ${ fns.getUvFromChannel }( ${ storage.attributes }[ i1 ], material.map );
						let c = ${ fns.getUvFromChannel }( ${ storage.attributes }[ i2 ], material.map );
						let uv = barycoord.x * a + barycoord.y * b + barycoord.z * c;
						let uvPrime = material.mapTransform * vec3f( uv, 1 );

						opacity *= ${ sampleTexel }( uvPrime.xy, material.map, 0 ).a;

					}

					// account for green component of alpha map
					if ( material.alphaMap != - 1 ) {

						let a = ${ fns.getUvFromChannel }( ${ storage.attributes }[ i0 ], material.alphaMap );
						let b = ${ fns.getUvFromChannel }( ${ storage.attributes }[ i1 ], material.alphaMap );
						let c = ${ fns.getUvFromChannel }( ${ storage.attributes }[ i2 ], material.alphaMap );
						let uv = barycoord.x * a + barycoord.y * b + barycoord.z * c;
						let uvPrime = material.alphaMapTransform * vec3f( uv, 1 );

						opacity *= ${ sampleTexel }( uvPrime.xy, material.alphaMap, 0 ).g;

					}

				}

				return opacity;

			}
		`;

		// the traversal shared by the first hit and shadow rays, bounded by the ray's "maxDist" - 0 means unbounded
		const raycastOptions = {
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

					// avoid 0 * infinity for rays parallel to a slab and on its boundary, as in three-mesh-bvh
					let parallel = ray.direction == vec3f( 0.0 );
					if ( any( parallel & ( ( ray.origin < boundsMin ) | ( ray.origin > boundsMax ) ) ) ) {

						return 0u;

					}

					let invDir = 1.0 / select( ray.direction, vec3f( 1.0 ), parallel );
					let tMinPlane = ( boundsMin - ray.origin ) * invDir;
					let tMaxPlane = ( boundsMax - ray.origin ) * invDir;

					// parallel axes never limit the slab interval
					const FLT_MAX = 3.402823e38;
					let tMinHit = select( min( tMinPlane, tMaxPlane ), vec3f( - FLT_MAX ), parallel );
					let tMaxHit = select( max( tMinPlane, tMaxPlane ), vec3f( FLT_MAX ), parallel );

					let t0 = max( max( tMinHit.x, tMinHit.y ), tMinHit.z );
					let t1 = min( min( tMaxHit.x, tMaxHit.y ), tMaxHit.z );

					let dist = max( t0, 0.0 );
					if ( t1 < dist ) {

						return 0u;

					} else if ( ray.maxDist > 0.0 && dist * ${ scratchRayScalar } >= ray.maxDist ) {

						return 0u;

					} else if ( result.didHit && dist * ${ scratchRayScalar } >= result.dist ) {

						return 0u;

					} else {

						return 1u;

					}

				}

			`,
			transformShapeFn: wgslTagFn/* wgsl */`
				fn transformRay( ray: ptr<function, ${ rayStruct }>, objectIndex: u32 ) -> void {

					let toLocal = ${ storage.transforms }[ objectIndex ].inverseMatrixWorld;
					ray.origin = ( toLocal * vec4f( ray.origin, 1.0 ) ).xyz;
					ray.direction = ( toLocal * vec4f( ray.direction, 0.0 ) ).xyz;

					let len = length( ray.direction );
					ray.direction /= len;
					${ scratchRayScalar } = 1.0 / len;

					let object = ${ storage.transforms }[ objectIndex ];
					${ currentObjectIndex } = objectIndex;

					let material = ${ materialsStorage }[ object.materialIndex ];
					if ( material.transparent == 1 ) {

						${ baseOpacityScalar } = material.opacity * object.color.a;

					} else {

						${ baseOpacityScalar } = 1.0;

					}

				}
			`,
			transformResultFn: wgslTagFn/* wgsl */`
				fn transformResult( hit: ptr<function, ${ intersectionResultStruct }>, objectIndex: u32 ) -> void {

					let toLocal = ${ storage.transforms }[ objectIndex ].inverseMatrixWorld;
					hit.normal = normalize( ( transpose( toLocal ) * vec4f( hit.normal, 0.0 ) ).xyz );
					hit.objectIndex = objectIndex;

				}
			`,
			resetShapeFn: wgslTagFn/* wgsl */`
				fn resetRayScalar( objectIndex: u32 ) -> void {

					${ scratchRayScalar } = 1.0;
					${ baseOpacityScalar } = 1.0;

				}
			`,
		};

		// the nearest hit on the material's visible side, past fully transparent and alpha tested surfaces
		fns.raycastFirstHit = this.getShapecastFn( {
			...raycastOptions,
			name: 'raycastFirstHit',
			intersectRangeFn: wgslTagFn/* wgsl */`
				fn intersectRange( ray: ${ rayStruct }, offset: u32, count: u32, result: ptr<function, ${ intersectionResultStruct }> ) -> u32 {

					var didHit = false;
					for ( var ti = offset; ti < offset + count; ti = ti + 1u ) {

						let i0 = ${ storage.index }[ ti * 3u ];
						let i1 = ${ storage.index }[ ti * 3u + 1u ];
						let i2 = ${ storage.index }[ ti * 3u + 2u ];

						let a = ${ storage.attributes }[ i0 ].position.xyz;
						let b = ${ storage.attributes }[ i1 ].position.xyz;
						let c = ${ storage.attributes }[ i2 ].position.xyz;

						var triResult = ${ intersectRayTriangle }( ray, a, b, c, 0.0 );
						triResult.dist *= ${ scratchRayScalar };
						if ( triResult.didHit && ( ray.maxDist <= 0.0 || triResult.dist < ray.maxDist ) && ( ! result.didHit || triResult.dist < result.dist ) ) {

							let object = ${ storage.transforms }[ ${ currentObjectIndex } ];
							let material = ${ materialsStorage }[ object.materialIndex ];

							// TODO: if material is a transmissive volume we may need to assume double-sidedness
							if ( material.side != 0 && triResult.side != material.side ) {

								continue;

							}

							// partial opacity is resolved at surface processing, but fully transparent and alpha
							// tested surfaces are skipped here
							let opacity = ${ getHitOpacity }( material, i0, i1, i2, triResult.barycoord );
							if ( ( material.transparent != 0 && opacity <= 0.0 ) || opacity < material.alphaTest ) {

								continue;

							}

							result.didHit = true;
							result.dist = triResult.dist;
							result.normal = triResult.normal;
							result.side = triResult.side;
							result.barycoord = triResult.barycoord;
							result.indices = vec4u( i0, i1, i2, ti );

							didHit = true;

						}

					}

					return select( ${ NOT_INTERSECTED }u, ${ INTERSECTED }u, didHit );

				}
			`,
		} );

		// shadow rays hit both sides, pass through the objects not visible to them and partially transparent
		// surfaces, and stop at the first opaque hit
		// TODO: shadow rays could use a thinner result struct with only the occlusion fields, building the
		// shared bounds test and result transform for each struct
		fns.raycastShadow = this.getShapecastFn( {
			...raycastOptions,
			name: 'raycastShadow',
			intersectRangeFn: wgslTagFn/* wgsl */`
				fn intersectShadowRange( ray: ${ rayStruct }, offset: u32, count: u32, result: ptr<function, ${ intersectionResultStruct }> ) -> u32 {

					for ( var ti = offset; ti < offset + count; ti = ti + 1u ) {

						let i0 = ${ storage.index }[ ti * 3u ];
						let i1 = ${ storage.index }[ ti * 3u + 1u ];
						let i2 = ${ storage.index }[ ti * 3u + 2u ];

						let a = ${ storage.attributes }[ i0 ].position.xyz;
						let b = ${ storage.attributes }[ i1 ].position.xyz;
						let c = ${ storage.attributes }[ i2 ].position.xyz;

						var triResult = ${ intersectRayTriangle }( ray, a, b, c, 0.0 );
						triResult.dist *= ${ scratchRayScalar };
						if ( triResult.didHit && ( ray.maxDist <= 0.0 || triResult.dist < ray.maxDist ) ) {

							let object = ${ storage.transforms }[ ${ currentObjectIndex } ];
							let material = ${ materialsStorage }[ object.materialIndex ];

							// pass fog volume boundaries, in any order: entering adds the fog's optical depth back from
							// the fog shadow distance, and leaving takes it away
							if ( material.fogVolume != 0 ) {

								let extinction = ${ materialExtinctionFn }( material.attenuationColor, material.attenuationDistance );
								let depth = extinction * ( ${ fogShadowDistanceFn }( ray.maxDist ) - triResult.dist );
								result.fogDepth += select( - depth, depth, triResult.side > 0.0 );
								continue;

							}

							let opacity = ${ getHitOpacity }( material, i0, i1, i2, triResult.barycoord );
							if ( ( material.transparent != 0 && opacity <= 0.0 ) || opacity < material.alphaTest ) {

								continue;

							}

							// skip the objects not visible to shadow rays. Record the share of bsdf rays this face
							// would stop: all of them if it's opaque, its opacity if it's partially transparent
							if ( object.visibleToShadowRays == 0u ) {

								if ( material.side == 0 || triResult.side == material.side ) {

									result.skippedOcclusion += ( 1.0 - result.skippedOcclusion ) * select( 1.0, opacity, material.transparent != 0 );

								}

								continue;

							}

							// pass partially transparent surfaces, each blocking its opacity's share of the light still
							// getting through, just as bsdf rays pass them by chance
							if ( material.transparent != 0 && opacity < 1.0 ) {

								result.occlusion += ( 1.0 - result.occlusion ) * opacity;
								continue;

							}

							// the first opaque hit ends the whole traversal
							result.didHit = true;
							return ${ STOP_TRAVERSAL }u;

						}

					}

					return ${ NOT_INTERSECTED }u;

				}
			`,
		} );

	}

	update() {

		this.updateUvAttributesFromScene();

		// the material indices are written with the transforms, so the shading model's materials must
		// be updated first
		super.update();

		// build the channel -> uv lookup now that the geometry struct (and its uv members) exist
		this.updateUvSampleFunction();
		this.updateColorSampleFn();

		this.bvhMap.clear();
		this.useTransparencyRaycastFn();

	}

	setShadingModel( shadingModel ) {

		this.shadingModel = shadingModel;
		this.updateMaterialIndices();

	}

	updateMaterialIndices() {

		const { storage, bvh } = this;
		const transformsStorage = storage.transforms.proxyNode;
		this._mediumIds.clear();
		this._getTransformMap( bvh ).forEach( info => {

			this.writeMaterialData( info, info.slot, transformsStorage.value.array.buffer );

		} );
		transformsStorage.value.needsUpdate = true;

	}

	writeMaterialData( info, writeOffset, targetBuffer ) {

		// write material data to the transforms
		const { shadingModel } = this;
		const { object, instanceId, root } = info;

		// get the material associated with the bvh group
		let material = object.material;
		if ( Array.isArray( material ) ) {

			const { materialIndex } = object.geometry.groups[ root ];
			material = material[ materialIndex ];

		}

		const transformBufferU32 = new Uint32Array( targetBuffer );

		const index = shadingModel.getMaterialIndex( material );
		if ( index === - 1 ) {

			// hide the object when there is no material
			transformBufferU32[ writeOffset * transformStruct.getLength() + 32 ] = 0;

		}

		// save the material index
		transformBufferU32[ writeOffset * transformStruct.getLength() + 33 ] = index;

		// slots are written in order, so the first one seen for a volume is its medium id
		const mediumKey = `${ object.uuid }_${ instanceId }_${ index }`;
		if ( ! this._mediumIds.has( mediumKey ) ) {

			this._mediumIds.set( mediumKey, writeOffset );

		}

		transformBufferU32[ writeOffset * transformStruct.getLength() + 35 ] = this._mediumIds.get( mediumKey );

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

	writeTransformData( info, premultiplyMatrix, writeOffset, targetBuffer ) {

		super.writeTransformData( info, premultiplyMatrix, writeOffset, targetBuffer );
		this.writeMaterialData( info, writeOffset, targetBuffer );

		// whether shadow rays see the object, in the slot after the material index
		const transformBufferU32 = new Uint32Array( targetBuffer );
		transformBufferU32[ writeOffset * this.structs.transform.getLength() + 34 ] = info.object.visibleToShadowRays === false ? 0 : 1;

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
				bvh.getBoundingBox( clonedMesh.boundingBox );
				bvh.geometry.computeBoundingBox();

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

				newBVH = new SkinnedMeshBVH( clonedMesh, { strategy: SAH, targetLeafSize: 5 } );

			} else {

				newBVH = new MeshBVH( proxyGeometry, { strategy: SAH, targetLeafSize: 5 } );

			}

			bvhMap.set( bvh, { bvh: newBVH, range: { ...rangeTarget } } );
			return newBVH;

		} else {

			return bvh;

		}

	}

	dispose() {

		// TODO: This belongs in three-mesh-bvh
		const { storage } = this;
		for ( const key in storage ) {

			storage[ key ].value?.dispose();

		}

	}

}
