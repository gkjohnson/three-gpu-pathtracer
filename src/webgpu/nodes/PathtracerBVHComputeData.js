import { BufferAttribute, BufferGeometry, StructTypeNode, Vector4, SkinnedMesh, Matrix3, Matrix4, Raycaster, Vector3, MeshBasicMaterial, DoubleSide } from 'three/webgpu';
import { BVHComputeData, intersectRayTriangle, bvhNodeBoundsStruct, bvhNodeStruct, rayStruct, wgslTagFn, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { float, uint } from 'three/tsl';
import { SkinnedMeshBVH, MeshBVH, SAH, NOT_INTERSECTED, INTERSECTED, STOP_TRAVERSAL, OrientedBox } from 'three-mesh-bvh';
import { getFogShadowDistanceFn } from './medium.wgsl.js';
import { ifFeature } from './features.js';
/** @import { Box3, Mesh } from 'three/webgpu' */

const _colorVec = new Vector4();
const _instanceMatrix = /* @__PURE__ */ new Matrix4();
const _boxToMesh = /* @__PURE__ */ new Matrix4();
const _orientedBox = /* @__PURE__ */ new OrientedBox();
const _normalMatrix = /* @__PURE__ */ new Matrix3();
const _rayOrigin = /* @__PURE__ */ new Vector3();
const _rayDirection = /* @__PURE__ */ new Vector3( 0, 0, 1 );

// raycasts a mesh instance from both sides
const _raycaster = /* @__PURE__ */ new Raycaster();
const _raycastTarget = {
	matrixWorld: _instanceMatrix,
	material: /* @__PURE__ */ new MeshBasicMaterial( { side: DoubleSide } ),
};

// three-mesh-bvh's object record with the material fields appended, and the words they're written at
const RECORD_VISIBLE_WORD = 32;
const RECORD_MATERIAL_INDEX_WORD = 35;
const RECORD_VISIBLE_TO_SHADOW_RAYS_WORD = 36;
const RECORD_COLOR_WORD = 40;
const objectRecordStruct = new StructTypeNode( {
	matrixWorld: 'mat4x4f',
	inverseMatrixWorld: 'mat4x4f',
	visible: 'uint',
	indexOffset: 'uint',
	attributesOffset: 'uint',
	materialIndex: 'uint',
	visibleToShadowRays: 'uint',
	_alignment0: 'uint',
	_alignment1: 'uint',
	_alignment2: 'uint',
	color: 'vec4f',
}, 'PathTracerObjectRecord' );

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

// a ray's nearest volume hit past "minDist"
const volumeHitStruct = new StructTypeNode( {
	didHit: 'bool',
	materialIndex: 'uint',
	dist: 'float',
	side: 'float',
	minDist: 'float',
}, 'VolumeHit' );

// Pathtracer-specific version of the BVHComputeData tht includes material mapping, property structs
export class PathtracerBVHComputeData extends BVHComputeData {

	constructor( bvh, shadingModel, options = {} ) {

		super( bvh, {
			attributes: {
				position: 'vec3f',
				normal: 'oct16',
				tangent: 'oct16',
			},
			...options,
		} );

		// the shading model owns the materials, the traversal reads them through the node context
		this.shadingModel = shadingModel;
		this.structs.objectRecord = objectRecordStruct;
		this.bvhMap = new Map();

	}

	/**
	 * Returns whether the box, in the space "boxToWorld" maps from, overlaps the mesh's closed volume.
	 *
	 * @param {Box3} box
	 * @param {Matrix4} boxToWorld
	 * @param {Mesh} mesh
	 * @returns {boolean}
	 */
	boxIntersectsMesh( box, boxToWorld, mesh ) {

		const instanceBVHs = this.bvh.bvhMap.get( mesh ) || [];
		for ( let instance = 0; instance < instanceBVHs.length; instance ++ ) {

			const instanceBVH = instanceBVHs[ instance ];
			if ( ! instanceBVH ) {

				continue;

			}

			_instanceMatrix.copy( mesh.matrixWorld );
			if ( mesh.isInstancedMesh || mesh.isBatchedMesh ) {

				mesh.getMatrixAt( instance, _instanceMatrix ).premultiply( mesh.matrixWorld );

			}

			_boxToMesh.copy( _instanceMatrix ).invert().multiply( boxToWorld );
			_orientedBox.set( box.min, box.max, _boxToMesh );
			_orientedBox.needsUpdate = true;

			// the volume's surface passes through the box
			const crossesSurface = instanceBVH.shapecast( {
				intersectsBounds: bounds => _orientedBox.intersectsBox( bounds ),
				intersectsTriangle: triangle => _orientedBox.intersectsTriangle( triangle ),
			} );

			if ( crossesSurface ) {

				return true;

			}

			// otherwise the box is inside if the nearest hit is a back face
			box.getCenter( _rayOrigin ).applyMatrix4( boxToWorld );
			_raycaster.set( _rayOrigin, _rayDirection );
			_raycaster.firstHitOnly = true;
			const hit = instanceBVH.raycastObject3D( _raycastTarget, _raycaster )[ 0 ];
			if ( hit ) {

				_normalMatrix.getNormalMatrix( _instanceMatrix );
				if ( hit.face.normal.applyMatrix3( _normalMatrix ).dot( _rayDirection ) > 0 ) {

					return true;

				}

			}

		}

		return false;

	}

	updateUvAttributesFromScene() {

		const { attributes } = this;
		const keys = new Set( [ 'color' ] );
		delete attributes.color;
		for ( let i = 0; i < 8; i ++ ) {

			const key = i === 0 ? 'uv' : 'uv' + i;
			delete attributes[ key ];
			keys.add( key );

		}

		this.getRootObject().traverse( c => {

			if ( c.geometry ) {

				for ( const key in c.geometry.attributes ) {

					if ( keys.has( key ) ) {

						if ( key === 'color' ) {

							attributes[ key ] = '4x16float';

						} else if ( /^uv/.test( key ) ) {

							attributes[ key ] = 'vec2f';

						} else {

							attributes[ key ] = 'vec4f';

						}

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

		// the shading model decides how a material's surfaces are hit and its volume traversed
		const getHitOpacity = contextProxyFn( 'shadingModel.fns.getHitOpacity' );
		const getMaterialMedium = contextProxyFn( 'shadingModel.fns.getMaterialMedium' );

		// the object being traversed, set when the ray is transformed into its space
		const currentObjectIndex = uint().toVar( 'bvh_objectIndex' );
		const scratchRayScalar = float( 1.0 ).toVar( 'bvh_rayScalar' );

		// the world distance at which the ray enters the bounds, or - 1 when it misses them
		const rayBoundsDistance = wgslTagFn/* wgsl */`
			fn rayBoundsDistance( ray: ${ rayStruct }, bounds: ${ bvhNodeBoundsStruct } ) -> f32 {

				let boundsMin = vec3( bounds.min[0], bounds.min[1], bounds.min[2] );
				let boundsMax = vec3( bounds.max[0], bounds.max[1], bounds.max[2] );

				// avoid 0 * infinity for rays parallel to a slab and on its boundary, as in three-mesh-bvh
				let parallel = ray.direction == vec3f( 0.0 );
				if ( any( parallel & ( ( ray.origin < boundsMin ) | ( ray.origin > boundsMax ) ) ) ) {

					return - 1.0;

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

					return - 1.0;

				}

				return dist * ${ scratchRayScalar };

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

					let dist = ${ rayBoundsDistance }( ray, bounds );
					if ( dist < 0.0 ) {

						return 0u;

					} else if ( ray.maxDist > 0.0 && dist >= ray.maxDist ) {

						return 0u;

					} else if ( result.didHit && dist >= result.dist ) {

						return 0u;

					} else {

						return 1u;

					}

				}

			`,
			transformShapeFn: wgslTagFn/* wgsl */`
				fn transformRay( ray: ptr<function, ${ rayStruct }>, objectIndex: u32 ) -> bool {

					let toLocal = ${ storage.objects }[ objectIndex ].inverseMatrixWorld;
					ray.origin = ( toLocal * vec4f( ray.origin, 1.0 ) ).xyz;
					ray.direction = ( toLocal * vec4f( ray.direction, 0.0 ) ).xyz;

					let len = length( ray.direction );
					ray.direction /= len;
					${ scratchRayScalar } = 1.0 / len;
					${ currentObjectIndex } = objectIndex;
					return true;

				}
			`,
			transformResultFn: wgslTagFn/* wgsl */`
				fn transformResult( hit: ptr<function, ${ intersectionResultStruct }>, objectIndex: u32 ) -> void {

					let toLocal = ${ storage.objects }[ objectIndex ].inverseMatrixWorld;
					hit.normal = normalize( ( transpose( toLocal ) * vec4f( hit.normal, 0.0 ) ).xyz );
					hit.objectIndex = objectIndex;

				}
			`,
			resetShapeFn: wgslTagFn/* wgsl */`
				fn resetRayScalar( objectIndex: u32 ) -> void {

					${ scratchRayScalar } = 1.0;

				}
			`,
		};

		// the nearest hit on the material's visible side, past fully transparent and alpha tested surfaces
		fns.raycastFirstHit = this.getShapecastFn( {
			...raycastOptions,
			name: 'raycastFirstHit',
			intersectRangeFn: wgslTagFn/* wgsl */`
				fn intersectRange( ray: ${ rayStruct }, offset: u32, count: u32, indexOffset: u32, attributesOffset: u32, result: ptr<function, ${ intersectionResultStruct }> ) -> u32 {

					var didHit = false;
					for ( var ti = offset; ti < offset + count; ti = ti + 1u ) {

						let indices = ${ fns.getTriangleIndices }( ti, indexOffset );
						let a = ${ fns.getVertexPosition }( indices.x, attributesOffset );
						let b = ${ fns.getVertexPosition }( indices.y, attributesOffset );
						let c = ${ fns.getVertexPosition }( indices.z, attributesOffset );

						var triResult = ${ intersectRayTriangle }( ray, a, b, c, 0.0 );
						triResult.dist *= ${ scratchRayScalar };
						if ( triResult.didHit && ( ray.maxDist <= 0.0 || triResult.dist < ray.maxDist ) && ( ! result.didHit || triResult.dist < result.dist ) ) {

							// partial opacity is resolved at surface processing, but faces on the side the material
							// doesn't render, fully transparent and alpha tested surfaces are skipped here
							let object = ${ storage.objects }[ ${ currentObjectIndex } ];
							let opacity = ${ getHitOpacity }( object.materialIndex, object.color.a, indices, attributesOffset, triResult.barycoord, triResult.side );
							if ( opacity <= 0.0 ) {

								continue;

							}

							result.didHit = true;
							result.dist = triResult.dist;
							result.normal = triResult.normal;
							result.side = triResult.side;
							result.barycoord = triResult.barycoord;
							result.indices = vec4u( indices, ti );

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
				fn intersectShadowRange( ray: ${ rayStruct }, offset: u32, count: u32, indexOffset: u32, attributesOffset: u32, result: ptr<function, ${ intersectionResultStruct }> ) -> u32 {

					for ( var ti = offset; ti < offset + count; ti = ti + 1u ) {

						let indices = ${ fns.getTriangleIndices }( ti, indexOffset );
						let a = ${ fns.getVertexPosition }( indices.x, attributesOffset );
						let b = ${ fns.getVertexPosition }( indices.y, attributesOffset );
						let c = ${ fns.getVertexPosition }( indices.z, attributesOffset );

						var triResult = ${ intersectRayTriangle }( ray, a, b, c, 0.0 );
						triResult.dist *= ${ scratchRayScalar };
						if ( triResult.didHit && ( ray.maxDist <= 0.0 || triResult.dist < ray.maxDist ) ) {

							let object = ${ storage.objects }[ ${ currentObjectIndex } ];

							// pass fog volume boundaries, in any order: entering adds the fog's optical depth back from
							// the fog shadow distance, and leaving takes it away
							${ ifFeature( 'FOG' )/* wgsl */`
								let medium = ${ getMaterialMedium }( object.materialIndex );
								if ( medium.fogVolume ) {

									let depth = medium.extinction * ( ${ getFogShadowDistanceFn }( ray.maxDist ) - triResult.dist );
									result.fogDepth += select( - depth, depth, triResult.side > 0.0 );
									continue;

								}
							` }

							// faces on either side block the light, past fully transparent and alpha tested surfaces
							let opacity = ${ getHitOpacity }( object.materialIndex, object.color.a, indices, attributesOffset, triResult.barycoord, 0.0 );
							if ( opacity <= 0.0 ) {

								continue;

							}

							// skip the objects not visible to shadow rays. Record the share of bsdf rays this face
							// would stop on the side the material renders: all of them if it's opaque, its opacity if
							// it's partially transparent
							if ( object.visibleToShadowRays == 0u ) {

								let sideOpacity = ${ getHitOpacity }( object.materialIndex, object.color.a, indices, attributesOffset, triResult.barycoord, triResult.side );
								result.skippedOcclusion += ( 1.0 - result.skippedOcclusion ) * sideOpacity;
								continue;

							}

							// pass partially transparent surfaces, each blocking its opacity's share of the light still
							// getting through, just as bsdf rays pass them by chance
							if ( opacity < 1.0 ) {

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

		// The nearest volume hit past "minDist"
		fns.raycastVolumeHit = this.getShapecastFn( {
			name: 'raycastVolumeHit',
			shapeStruct: rayStruct,
			resultStruct: volumeHitStruct,

			boundsOrderFn: raycastOptions.boundsOrderFn,
			intersectsBoundsFn: wgslTagFn/* wgsl */`
				fn volumeRayIntersectsBounds( ray: ${ rayStruct }, bounds: ${ bvhNodeBoundsStruct }, result: ptr<function, ${ volumeHitStruct }> ) -> u32 {

					let dist = ${ rayBoundsDistance }( ray, bounds );
					if ( dist < 0.0 || ( result.didHit && dist >= result.dist ) ) {

						return 0u;

					}

					return 1u;

				}
			`,
			intersectRangeFn: wgslTagFn/* wgsl */`
				fn intersectVolumeRange( ray: ${ rayStruct }, offset: u32, count: u32, indexOffset: u32, attributesOffset: u32, result: ptr<function, ${ volumeHitStruct }> ) -> u32 {

					let object = ${ storage.objects }[ ${ currentObjectIndex } ];

					var didHit = false;
					for ( var ti = offset; ti < offset + count; ti = ti + 1u ) {

						let indices = ${ fns.getTriangleIndices }( ti, indexOffset );
						let a = ${ fns.getVertexPosition }( indices.x, attributesOffset );
						let b = ${ fns.getVertexPosition }( indices.y, attributesOffset );
						let c = ${ fns.getVertexPosition }( indices.z, attributesOffset );

						var triResult = ${ intersectRayTriangle }( ray, a, b, c, 0.0 );
						triResult.dist *= ${ scratchRayScalar };
						if ( ! triResult.didHit || triResult.dist <= result.minDist || ( result.didHit && triResult.dist >= result.dist ) ) {

							continue;

						}

						// fully transparent and alpha tested surfaces on either side are passed
						let opacity = ${ getHitOpacity }( object.materialIndex, object.color.a, indices, attributesOffset, triResult.barycoord, 0.0 );
						if ( opacity <= 0.0 ) {

							continue;

						}

						result.didHit = true;
						result.materialIndex = object.materialIndex;
						result.dist = triResult.dist;
						result.side = triResult.side;

						didHit = true;

					}

					return select( ${ NOT_INTERSECTED }u, ${ INTERSECTED }u, didHit );

				}
			`,
			// objects that aren't volumes are skipped
			transformShapeFn: wgslTagFn/* wgsl */`
				fn transformVolumeRay( ray: ptr<function, ${ rayStruct }>, objectIndex: u32 ) -> bool {

					let isVolume = ${ getMaterialMedium }( ${ storage.objects }[ objectIndex ].materialIndex ).volume;
					return isVolume && ${ raycastOptions.transformShapeFn }( ray, objectIndex );

				}
			`,
			resetShapeFn: raycastOptions.resetShapeFn,
		} );

	}

	async update() {

		this.updateUvAttributesFromScene();

		// the material indices are written with the object records, so the shading model's materials must
		// be updated first
		const { bvh } = this;
		await super.update();

		// nothing was built when a later "update" or "dispose" cancelled this one
		if ( this.bvh === bvh ) {

			return;

		}

		// build the channel -> uv lookup now that the geometry struct (and its uv members) exist
		this.updateUvSampleFunction();
		this.updateColorSampleFn();

		this.bvhMap.clear();
		this.useTransparencyRaycastFn();

	}

	updateTransforms() {

		// the first "update" writes them
		if ( this.bvh !== null ) {

			super.updateTransforms();

		}

	}

	setShadingModel( shadingModel ) {

		this.shadingModel = shadingModel;
		this.updateMaterialIndices();

	}

	updateMaterialIndices() {

		// the first "update" writes them with the object records
		const objectsStorage = this.storage.objects.proxyNode;
		if ( objectsStorage === null ) {

			return;

		}

		this.getAllObjectInfo().forEach( info => {

			this.writeMaterialData( info, info.objectIndex, objectsStorage.value.array.buffer );

		} );
		objectsStorage.value.needsUpdate = true;

	}

	writeMaterialData( info, writeOffset, targetBuffer ) {

		// write material data to the object record
		const { shadingModel } = this;
		const { object, instanceId, group } = info;

		// get the material associated with the bvh group
		let material = object.material;
		if ( Array.isArray( material ) ) {

			const { materialIndex } = object.geometry.groups[ group ];
			material = material[ materialIndex ];

		}

		const recordOffset = writeOffset * objectRecordStruct.getLength();
		const recordBufferU32 = new Uint32Array( targetBuffer );

		const index = shadingModel.getMaterialIndex( material );
		if ( index === - 1 ) {

			// hide the object when there is no material
			recordBufferU32[ recordOffset + RECORD_VISIBLE_WORD ] = 0;

		}

		// save the material index
		recordBufferU32[ recordOffset + RECORD_MATERIAL_INDEX_WORD ] = index;

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

		_colorVec.toArray( new Float32Array( targetBuffer ), recordOffset + RECORD_COLOR_WORD );

	}

	writeObjectRecord( info, premultiplyMatrix, writeOffset, targetBuffer ) {

		super.writeObjectRecord( info, premultiplyMatrix, writeOffset, targetBuffer );
		this.writeMaterialData( info, writeOffset, targetBuffer );

		// whether shadow rays see the object
		const recordBufferU32 = new Uint32Array( targetBuffer );
		recordBufferU32[ writeOffset * objectRecordStruct.getLength() + RECORD_VISIBLE_TO_SHADOW_RAYS_WORD ] = info.object.visibleToShadowRays === false ? 0 : 1;

	}

	getBVH( object, instanceId, rangeTarget ) {

		const { bvhMap } = this;
		const bvh = super.getBVH( object, instanceId, rangeTarget );
		if ( bvhMap.has( bvh ) ) {

			const data = bvhMap.get( bvh );
			Object.assign( rangeTarget, data.range );
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

}
