import { Matrix4, StructTypeNode } from 'three/webgpu';
import { uniform, uint, float } from 'three/tsl';
import { wgslTagFn, ndcToCameraRay, rayStruct, bvhNodeBoundsStruct, bvhNodeStruct, intersectsTriangle } from 'three-mesh-bvh/webgpu';

// blue -> cyan -> green -> yellow -> red heat ramp shared by the debug visualizations
export const heatColorFn = wgslTagFn/* wgsl */`
	fn debugHeatColor( t: f32 ) -> vec3f {

		let r = clamp( 1.5 - abs( 4.0 * t - 3.0 ), 0.0, 1.0 );
		let g = clamp( 1.5 - abs( 4.0 * t - 2.0 ), 0.0, 1.0 );
		let b = clamp( 1.5 - abs( 4.0 * t - 1.0 ), 0.0, 1.0 );
		return vec3f( r, g, b );

	}
`;

// Result struct holding a running tally of the TLAS and BLAS bounding boxes the ray crosses
const debugBoundsResultStruct = new StructTypeNode( {
	tlasCount: 'uint',
	blasCount: 'uint',
	didHit: 'bool',
	dist: 'float',
}, 'DebugBoundsResult' );

// Builds the full-screen "bvh bounds heatmap" fragment function for the given bvh data. The uniforms
// driving it are attached as `.uniforms` so the caller can update them each frame.
export function getDebugBoundsFunction( bvhData ) {

	const { transforms, index, attributes, materials } = bvhData.storage;

	// uniforms

	// camera transforms used to build the ray
	const cameraToModelMatrix = uniform( new Matrix4() );
	const inverseProjectionMatrix = uniform( new Matrix4() );

	// 1 / 0 flags toggling which bvh levels contribute to the count
	const displayTLAS = uniform( 1 );
	const displayBLAS = uniform( 1 );

	// 1 / 0 flag, stop counting boxes past the nearest hit surface
	const stopAtSurface = uniform( 0 );

	// node count that saturates to full heat
	const saturationCount = uniform( 64 );

	// shared traversal state, mirroring the path tracer's raycast:
	// - level: 0 while walking the TLAS, 1 while walking a BLAS ( picks which counter to bump )
	// - rayScalar: factor converting a local-space hit distance back to world units
	// - materialSide: side of the current object's material, for front / backface culling
	const level = uint( 0 ).toVar( 'bvh_debugBoundsLevel' );
	const rayScalar = float( 1.0 ).toVar( 'bvh_debugRayScalar' );
	const materialSide = float( 0.0 ).toVar( 'bvh_debugMaterialSide' );

	// front-to-back child ordering: descend the child the ray reaches first
	const getBoundsOrder = wgslTagFn/* wgsl */`
		fn debugGetBoundsOrder( ray: ${ rayStruct }, splitAxis: u32, node: ${ bvhNodeStruct } ) -> bool {

			return ray.direction[ splitAxis ] >= 0.0;

		}
	`;

	// bounds hook: tally the box (into the level's counter) and keep descending, unless it sits
	// entirely behind the nearest hit surface found so far
	const intersectsBounds = wgslTagFn/* wgsl */`
		fn debugIntersectsBounds( ray: ${ rayStruct }, bounds: ${ bvhNodeBoundsStruct }, result: ptr<function, ${ debugBoundsResultStruct }> ) -> u32 {

			let boundsMin = vec3( bounds.min[ 0 ], bounds.min[ 1 ], bounds.min[ 2 ] );
			let boundsMax = vec3( bounds.max[ 0 ], bounds.max[ 1 ], bounds.max[ 2 ] );

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

			} else if ( result.didHit && dist * ${ rayScalar } >= result.dist ) {

				return 0u;

			}

			if ( ${ level } == 1u ) {

				result.blasCount = result.blasCount + 1u;

			} else {

				result.tlasCount = result.tlasCount + 1u;

			}

			return 1u;

		}
	`;

	// range hook: intersect the leaf triangles to track the nearest surface
	const intersectRange = wgslTagFn/* wgsl */`
		fn debugIntersectRange( ray: ${ rayStruct }, offset: u32, count: u32, result: ptr<function, ${ debugBoundsResultStruct }> ) -> bool {

			var didHit = false;
			if ( ${ stopAtSurface } > 0.5 ) {

				for ( var ti = offset; ti < offset + count; ti = ti + 1u ) {

					let i0 = ${ index }[ ti * 3u ];
					let i1 = ${ index }[ ti * 3u + 1u ];
					let i2 = ${ index }[ ti * 3u + 2u ];

					let a = ${ attributes }[ i0 ].position.xyz;
					let b = ${ attributes }[ i1 ].position.xyz;
					let c = ${ attributes }[ i2 ].position.xyz;

					var triResult = ${ intersectsTriangle }( ray, a, b, c );
					triResult.dist *= ${ rayScalar };
					if ( triResult.didHit && ( ! result.didHit || triResult.dist < result.dist ) ) {

						// cull faces that don't match the material side
						if ( ${ materialSide } != 0.0 && triResult.side != ${ materialSide } ) {

							continue;

						}

						result.didHit = true;
						result.dist = triResult.dist;
						didHit = true;

					}

				}

			}

			return didHit;

		}
	`;

	// transform hook: move the ray into object-local space ( normalizing the direction and storing
	// the scale factor, exactly like the raycast ), record the material side, and mark that we are
	// now descending a BLAS
	const transformRay = wgslTagFn/* wgsl */`
		fn debugTransformRay( ray: ptr<function, ${ rayStruct }>, objectIndex: u32 ) -> void {

			let object = ${ transforms }[ objectIndex ];
			let toLocal = object.inverseMatrixWorld;
			ray.origin = ( toLocal * vec4f( ray.origin, 1.0 ) ).xyz;
			ray.direction = ( toLocal * vec4f( ray.direction, 0.0 ) ).xyz;

			let len = length( ray.direction );
			ray.direction = ray.direction / len;
			${ rayScalar } = 1.0 / len;

			${ materialSide } = ${ materials }[ object.materialIndex ].side;
			${ level } = 1u;

		}
	`;

	// reset hook: back to the TLAS once a BLAS has been fully traversed
	const resetLevel = wgslTagFn/* wgsl */`
		fn debugResetLevel( objectIndex: u32 ) -> void {

			${ rayScalar } = 1.0;
			${ level } = 0u;

		}
	`;

	// reuse the path tracer's traversal to count boxes across the TLAS and every BLAS it references
	const countBounds = bvhData.getShapecastFn( {
		name: 'debugBoundsCount',
		shapeStruct: rayStruct,
		resultStruct: debugBoundsResultStruct,

		boundsOrderFn: getBoundsOrder,
		intersectsBoundsFn: intersectsBounds,
		intersectRangeFn: intersectRange,
		transformShapeFn: transformRay,
		resetShapeFn: resetLevel,
	} );

	const debugBounds = wgslTagFn/* wgsl */`
		fn debugBounds( vUv: vec2f ) -> vec4f {

			let ndc = vUv * 2.0 - vec2f( 1.0 );
			var ray = ${ ndcToCameraRay }( ndc, ${ cameraToModelMatrix } * ${ inverseProjectionMatrix } );
			ray.direction = normalize( ray.direction );

			// count the boxes the ray crosses, pruning those behind the nearest hit surface
			var result: ${ debugBoundsResultStruct };
			${ countBounds }( ray, &result );

			let tlas = select( 0u, result.tlasCount, ${ displayTLAS } > 0.5 );
			let blas = select( 0u, result.blasCount, ${ displayBLAS } > 0.5 );
			let count = tlas + blas;

			let t = clamp( f32( count ) / max( ${ saturationCount }, 1.0 ), 0.0, 1.0 );

			return vec4f( ${ heatColorFn }( t ), 1.0 );

		}
	`;

	debugBounds.uniforms = {
		cameraToModelMatrix,
		inverseProjectionMatrix,
		displayTLAS,
		displayBLAS,
		stopAtSurface,
		saturationCount,
	};

	return debugBounds;

}
