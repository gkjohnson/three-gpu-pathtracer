/** @import { Object3D } from 'three' */
/** @import { ShadingModel } from '../shadingModels/ShadingModel.js' */
import { BufferAttribute, BufferGeometry, StructTypeNode, Vector3, Vector4, Matrix4, Color, SkinnedMesh, BackSide, DoubleSide } from 'three/webgpu';
import { BVHComputeData, intersectRayTriangle, bvhNodeBoundsStruct, bvhNodeStruct, rayStruct, wgslTagFn, contextProxy, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { float, bool, uint } from 'three/tsl';
import { SkinnedMeshBVH, MeshBVH, SAH } from 'three-mesh-bvh';

const _colorVec = new Vector4();
const _range = { start: 0, count: 0, vertexStart: 0, vertexCount: 0 };
const _matrix = new Matrix4();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _normal = new Vector3();
const _emission = new Color();

// vec4 items per emissive triangle, see LightsInfoNode
const EMISSIVE_TRIANGLE_STRIDE = 4;

const getObjectKey = ( object, instanceId, root ) => `${ object.uuid }_${ instanceId }_${ root }`;
const transformStruct = new StructTypeNode( {
	matrixWorld: 'mat4x4f',
	inverseMatrixWorld: 'mat4x4f',
	visible: 'uint',
	materialIndex: 'uint',
	visibleToShadowRays: 'uint',
	_alignment0: 'uint',
	color: 'vec4f',
}, 'TransformStruct' );

// three-mesh-bvh's ray hit result. Shadow rays also record the share of bsdf rays the faces they skipped
// would stop, and the share of light the partially transparent surfaces they passed block
const intersectionResultStruct = new StructTypeNode( {
	indices: 'vec4u',
	normal: 'vec3f',
	didHit: 'bool',
	barycoord: 'vec3f',
	objectIndex: 'uint',
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
		this.objectInfo = new Map();

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

		// raycast first hit, bounded by the ray's "maxDist" - 0 means unbounded
		const currentMaterialIndex = uint().toVar( 'bvh_materialIndex' );
		const scratchRayScalar = float( 1.0 ).toVar( 'bvh_rayScalar' );
		const baseOpacityScalar = float( 1.0 ).toVar( 'bvh_baseOpacity' );

		// shadow rays hit both sides, pass through the objects not visible to them and partially transparent
		// surfaces, and stop at the first opaque hit
		const isShadowRay = bool( false ).toVar( 'bvh_isShadowRay' );

		// camera rays look through the back of single sided surfaces, as the rasterizer does, and so do the rays
		// past them unless the shading model's "occludingBackFaces" has them hit it like shadow rays do, where the
		// kernels end the path. Set by the kernels before tracing
		const cullBackFaces = bool( true ).toVar( 'bvh_cullBackFaces' );
		this.cullBackFaces = cullBackFaces;
		const skipShadowObject = bool( false ).toVar( 'bvh_skipShadowObject' );

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

					// early-out if our object is completely transparent, or a shadow ray is already occluded
					if ( ${ baseOpacityScalar } == 0.0 || ( ${ isShadowRay } && result.didHit ) ) {

						return 0u;

					}

					let boundsMin = vec3( bounds.min[0], bounds.min[1], bounds.min[2] );
					let boundsMax = vec3( bounds.max[0], bounds.max[1], bounds.max[2] );

					let invDir = 1.0 / ray.direction;
					let tMinPlane = ( boundsMin - ray.origin ) * invDir;
					let tMaxPlane = ( boundsMax - ray.origin ) * invDir;

					let tMinHit = min( tMinPlane, tMaxPlane );
					let tMaxHit = max( tMinPlane, tMaxPlane );

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

						var triResult = ${ intersectRayTriangle }( ray, a, b, c, 0.0 );
						triResult.dist *= ${ scratchRayScalar };
						if ( triResult.didHit && ( ray.maxDist <= 0.0 || triResult.dist < ray.maxDist ) && ( ! result.didHit || triResult.dist < result.dist ) ) {

							let material = ${ materialsStorage }[ ${ currentMaterialIndex } ];

							// TODO: if material is a transmissive volume we may need to assume double-sidedness
							// shadow rays hit both sides, and with "occludingBackFaces" so do bounce rays
							if ( ! ${ isShadowRay } && ${ cullBackFaces } && material.side != 0 && triResult.side != material.side ) {

								continue;

							}

							var opacity = ${ baseOpacityScalar };
							if ( material.transparent != 0 || material.alphaTest > 0.0 ) {

								// add support for vertex color opacity
								if ( material.vertexColors == 1 ) {

									let barycoord = triResult.barycoord;
									let a = ${ fns.getColor }( ${ storage.attributes }[ i0 ] );
									let b = ${ fns.getColor }( ${ storage.attributes }[ i1 ] );
									let c = ${ fns.getColor }( ${ storage.attributes }[ i2 ] );
									let col = barycoord.x * a + barycoord.y * b + barycoord.z * c;

									opacity *= col.a;

								}

								// account for alpha component of albedo map
								if ( material.map != - 1 ) {

									let barycoord = triResult.barycoord;
									let a = ${ fns.getUvFromChannel }( ${ storage.attributes }[ i0 ], material.map );
									let b = ${ fns.getUvFromChannel }( ${ storage.attributes }[ i1 ], material.map );
									let c = ${ fns.getUvFromChannel }( ${ storage.attributes }[ i2 ], material.map );
									let uv = barycoord.x * a + barycoord.y * b + barycoord.z * c;
									let uvPrime = material.mapTransform * vec3f( uv, 1 );

									opacity *= ${ sampleTexel }( uvPrime.xy, material.map, 0 ).a;

								}

								// account for green component of alpha map
								if ( material.alphaMap != - 1 ) {

									let barycoord = triResult.barycoord;
									let a = ${ fns.getUvFromChannel }( ${ storage.attributes }[ i0 ], material.alphaMap );
									let b = ${ fns.getUvFromChannel }( ${ storage.attributes }[ i1 ], material.alphaMap );
									let c = ${ fns.getUvFromChannel }( ${ storage.attributes }[ i2 ], material.alphaMap );
									let uv = barycoord.x * a + barycoord.y * b + barycoord.z * c;
									let uvPrime = material.alphaMapTransform * vec3f( uv, 1 );

									opacity *= ${ sampleTexel }( uvPrime.xy, material.alphaMap, 0 ).g;

								}

								// Opacity is resolved at surface processing but skip full transparent hits here.
								if ( material.transparent != 0 && opacity <= 0.0 ) {

									continue;

								}

								if ( opacity < material.alphaTest ) {

									continue;

								}

							}

							// shadow rays skip the objects not visible to them. Record the share of bsdf rays this face
							// would stop: all of them if it's opaque, its opacity if it's partially transparent
							if ( ${ skipShadowObject } ) {

								if ( material.side == 0 || triResult.side == material.side ) {

									result.skippedOcclusion += ( 1.0 - result.skippedOcclusion ) * select( 1.0, opacity, material.transparent != 0 );

								}

								continue;

							}

							// shadow rays pass partially transparent surfaces, each blocking its opacity's share of the
							// light still getting through, just as bsdf rays pass them by chance
							if ( ${ isShadowRay } && material.transparent != 0 && opacity < 1.0 ) {

								result.occlusion += ( 1.0 - result.occlusion ) * opacity;
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

					return didHit;

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
					${ currentMaterialIndex } = object.materialIndex;

					let material = ${ materialsStorage }[ object.materialIndex ];
					if ( material.transparent == 1 ) {

						${ baseOpacityScalar } = material.opacity * object.color.a;

					} else {

						${ baseOpacityScalar } = 1.0;

					}

					${ skipShadowObject } = ${ isShadowRay } && object.visibleToShadowRays == 0u;

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

		fns.raycastFirstHit = this.getShapecastFn( {
			...raycastOptions,
			name: 'raycastFirstHit',
			prefixFn: wgslTagFn/* wgsl */`
				fn initFirstHitCull() -> void {

					${ isShadowRay } = false;

				}
			`,
		} );

		fns.raycastShadow = this.getShapecastFn( {
			...raycastOptions,
			name: 'raycastShadow',
			prefixFn: wgslTagFn/* wgsl */`
				fn initShadowCull() -> void {

					${ isShadowRay } = true;

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
		this.updateObjectInfo();

		this.bvhMap.clear();
		this.useTransparencyRaycastFn();

	}

	// records where each object's geometry groups were packed. Each geometry is packed once, in the
	// order the transforms first reference it
	updateObjectInfo() {

		const { bvh, objectInfo } = this;
		const geometryOffsets = new Map();
		let triangleCount = 0;
		objectInfo.clear();
		this._getTransformMap( bvh ).forEach( ( { object, instanceId, root, slot } ) => {

			const primBvh = this.getBVH( object, instanceId, _range );
			if ( ! geometryOffsets.has( primBvh ) ) {

				// a non indirect bvh stores absolute leaf offsets, so the range start is shifted back
				geometryOffsets.set( primBvh, triangleCount - ( primBvh.indirect ? 0 : _range.start / 3 ) );
				triangleCount += _range.count / 3;

			}

			objectInfo.set( getObjectKey( object, instanceId, root ), {
				slot,
				triangleOffset: geometryOffsets.get( primBvh ),
				triangleStart: _range.start / 3,
				triangleCount: _range.count / 3,
			} );

		} );

	}

	/**
	 * The transform slot of an object's geometry group and the offset of the geometry's first
	 * triangle in the merged index buffer, so a hook can address the object's triangles the way the
	 * kernels do.
	 *
	 * @param {Object3D} object
	 * @param {number} [instanceId=0]
	 * @param {number} [root=0] - Geometry group index.
	 * @returns {{ slot: number, triangleOffset: number }}
	 */
	getObjectInfo( object, instanceId = 0, root = 0 ) {

		return this.objectInfo.get( getObjectKey( object, instanceId, root ) );

	}

	/**
	 * Collects the triangles of the emissive surfaces that next event estimation samples as lights, in the
	 * space the kernels trace in, with their power for choosing between them and, per transform slot, the
	 * factor that turns a hit's distance and cosine into the pdf of having sampled it. See LightsInfoNode.
	 *
	 * @param {ShadingModel} shadingModel
	 * @returns {{ triangles: Float32Array, slots: Float32Array, count: number, power: number, bounds: Vector4 }}
	 */
	getEmissiveLights( shadingModel ) {

		const { storage, structs, bvh } = this;
		const transformsArray = storage.transforms.proxyNode.value.array;
		const transformsF32 = new Float32Array( transformsArray.buffer );
		const transformsU32 = new Uint32Array( transformsArray.buffer );
		const transformStride = structs.transform.getLength();
		const indexArray = storage.index.proxyNode.value.array;
		const attributesF32 = new Float32Array( storage.attributes.proxyNode.value.array.buffer );
		const attributeStruct = structs.attributes.proxyNode;
		const attributeStride = attributeStruct.getLength();

		// every geometry attribute is a vec4
		const positionOffset = 4 * attributeStruct.membersLayout.findIndex( ( { name } ) => name === 'position' );

		const transformMap = this._getTransformMap( bvh );
		const slotFactors = new Float32Array( transformMap.size );
		const emitters = [];
		const boundsMin = new Vector3( Infinity, Infinity, Infinity );
		const boundsMax = new Vector3( - Infinity, - Infinity, - Infinity );
		let totalPower = 0;

		transformMap.forEach( ( { object, instanceId, root, slot } ) => {

			let material = object.material;
			if ( Array.isArray( material ) ) {

				material = material[ object.geometry.groups[ root ].materialIndex ];

			}

			const base = slot * transformStride;
			const visible = transformsU32[ base + 32 ] !== 0;
			if ( ! visible || ! material || shadingModel.getMaterialIndex( material ) === - 1 || ! shadingModel.getLightEmission( material, _emission ) ) {

				return;

			}

			// the triangles of the geometry group the slot draws
			const info = this.getObjectInfo( object, instanceId, root );
			let start = info.triangleStart;
			let end = info.triangleStart + info.triangleCount;
			const { groups } = object.geometry;
			if ( groups.length > 0 && ! object.isBatchedMesh ) {

				start = Math.max( start, groups[ root ].start / 3 );
				end = Math.min( end, ( groups[ root ].start + groups[ root ].count ) / 3 );

			}

			// emitting sides, by the world space winding: mirrored transforms flip it
			_matrix.fromArray( transformsF32, base );
			let sides = material.side === DoubleSide ? 2 : ( material.side === BackSide ? 1 : 0 );
			if ( sides !== 2 && _matrix.determinant() < 0 ) {

				sides = 1 - sides;

			}

			const luminance = 0.2126 * _emission.r + 0.7152 * _emission.g + 0.0722 * _emission.b;
			const sideCount = sides === 2 ? 2 : 1;
			for ( let t = start; t < end; t ++ ) {

				const triangle = info.triangleOffset + t;
				_a.fromArray( attributesF32, indexArray[ 3 * triangle ] * attributeStride + positionOffset ).applyMatrix4( _matrix );
				_b.fromArray( attributesF32, indexArray[ 3 * triangle + 1 ] * attributeStride + positionOffset ).applyMatrix4( _matrix );
				_c.fromArray( attributesF32, indexArray[ 3 * triangle + 2 ] * attributeStride + positionOffset ).applyMatrix4( _matrix );
				boundsMin.min( _a ).min( _b ).min( _c );
				boundsMax.max( _a ).max( _b ).max( _c );

				_b.sub( _a );
				_c.sub( _a );
				const area = _normal.crossVectors( _b, _c ).length() / 2;
				if ( area > 0 ) {

					const power = luminance * area * sideCount;
					totalPower += power;
					emitters.push( {
						corner: _a.clone(), edge1: _b.clone(), edge2: _c.clone(),
						power, sides, emission: _emission.clone(), luminance: luminance * sideCount,
					} );

				}

			}

			slotFactors[ slot ] = luminance * sideCount;

		} );

		// the pdf factors were the luminance per area, now relative to the total power
		const count = emitters.length;
		const triangles = new Float32Array( Math.max( count, 1 ) * EMISSIVE_TRIANGLE_STRIDE * 4 );
		const bounds = new Vector4();
		if ( count > 0 ) {

			for ( let i = 0; i < slotFactors.length; i ++ ) {

				slotFactors[ i ] /= totalPower;

			}

			let cumulative = 0;
			emitters.forEach( ( { corner, edge1, edge2, power, sides, emission, luminance }, i ) => {

				cumulative += power;

				const offset = i * EMISSIVE_TRIANGLE_STRIDE * 4;
				corner.toArray( triangles, offset );
				triangles[ offset + 3 ] = i === count - 1 ? 1 : cumulative / totalPower;
				edge1.toArray( triangles, offset + 4 );
				edge2.toArray( triangles, offset + 8 );
				triangles[ offset + 11 ] = sides;
				emission.toArray( triangles, offset + 12 );
				triangles[ offset + 15 ] = luminance / totalPower;

			} );

			const center = boundsMin.clone().add( boundsMax ).multiplyScalar( 0.5 );
			bounds.set( center.x, center.y, center.z, boundsMin.distanceTo( boundsMax ) / 2 );

		}

		return { triangles, slots: slotFactors, count, power: totalPower, bounds };

	}

	setShadingModel( shadingModel ) {

		this.shadingModel = shadingModel;
		this.updateMaterialIndices();

	}

	updateMaterialIndices() {

		const { storage, bvh } = this;
		const transformsStorage = storage.transforms.proxyNode;
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
