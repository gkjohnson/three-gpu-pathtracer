/** @import { StructTypeNode } from 'three/webgpu' */
/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { wgslTagCode, wgslTagFn } from '../nodes/WGSLTagFnNode.js';
import { BVH_STACK_DEPTH } from '../tsl/constants.js';

/**
 * Builds a WGSL shapecast function that traverses the TLAS and per-object BLAS in a single
 * merged stack/loop for a custom shape type. The returned function signature is:
 * `fn name( shape: ShapeStruct[, result: ptr<function, ResultStruct>] ) -> bool`
 *
 * @private
 * @param {BVHComputeData} bvhData - The compute data whose storage buffers are referenced.
 * @param {Object} options
 * @param {string} [options.name] - Function name. Defaults to a random identifier.
 * @param {StructTypeNode} options.shapeStruct - TSL struct or definition describing the query shape.
 * @param {StructTypeNode|null} [options.resultStruct] - TSL struct for the accumulated result, or null.
 * @param {Function|null} [options.boundsOrderFn] - function node controlling left/right child traversal order.
 * @param {Function} options.intersectsBoundsFn - function node testing the shape against a BVH node's bounds.
 * @param {Function} options.intersectRangeFn - function node testing the shape against a leaf triangle range.
 * @param {Function|null} [options.transformShapeFn] - function node that transforms the shape into object local space.
 * @param {Function|null} [options.transformResultFn] - function node that transforms a hit result back to world space.
 * @param {Function|null} [options.resetShapeFn] - function node called after each BLAS traversal to reset any per-object state set by `transformShapeFn`.
 * @returns {Function} TSL function node for the traversal.
 */
export function getShapecastFn( bvhData, options ) {

	// TODO: test with and verify use with TSL Fn - both passing them as arguments,
	// calling the function from a TSL Fn.
	// TODO: revisit the semantics and mental model of "transformShapeFn" and "transformResultFn".
	// Are they "before" and "after" hooks? Should they include words implying a direction of transform?
	// eg "toLocal" / "toWorld"?
	const {
		name = `bvh_shapecast_fn_${ Math.random().toString( 36 ).substring( 2, 7 ) }`,
		shapeStruct,
		resultStruct = null,

		boundsOrderFn = null,
		intersectsBoundsFn,
		intersectRangeFn,
		transformShapeFn = null,
		transformResultFn = null,
		resetShapeFn = null,
	} = options;

	// these are proxy nodes, so they can be referenced before the storage buffers exist
	const { nodes, transforms } = bvhData.storage;

	// handle optional functions
	let transformResultSnippet = '';
	if ( transformResultFn ) {

		transformResultSnippet = wgslTagCode/* wgsl */`${ transformResultFn }( result, objectIndex );`;

	}

	let transformShapeSnippet = '';
	if ( transformShapeFn ) {

		transformShapeSnippet = wgslTagCode/* wgsl */`${ transformShapeFn }( &localShape, objectIndex );`;

	}

	let resetShapeSnippet = '';
	if ( resetShapeFn ) {

		resetShapeSnippet = wgslTagCode/* wgsl */`${ resetShapeFn }( objectIndex );`;

	}

	let leftToRightSnippet = '';
	if ( boundsOrderFn ) {

		leftToRightSnippet = wgslTagCode/* wgsl */`
			let leftToRight = ${ boundsOrderFn }( localShape, splitAxis, node );
			c1 = select( rightIndex, leftIndex, leftToRight );
			c2 = select( leftIndex, rightIndex, leftToRight );
		`;

	}

	const resultPtrSnippet = resultStruct ? wgslTagCode/* wgsl */`result: ptr<function, ${ resultStruct }>` : '';
	const resultArg = resultStruct ? 'result' : '';
	const stackSnippet = wgslTagCode/* wgsl */`
		var<workgroup> stack: array<u32, 64 * ${ BVH_STACK_DEPTH }>;
		// var<private> stack: array<u32, ${ BVH_STACK_DEPTH }>;
	`;

	// The TLAS and per-object BLAS are traversed with a single shared stack and loop. A thread
	// inside a BLAS ( using its transformed localShape ) and a thread still in the TLAS run the
	// same loop body, keeping SIMD lanes converged instead of recursing into a separate BLAS fn.
	const tlasFn = wgslTagFn/* wgsl */`
		${ [ stackSnippet ] }

		// fn
		fn ${ name }( shape: ${ shapeStruct }, ${ resultPtrSnippet } ) -> bool {

			var didHit = false;


			var isTLAS = true;

			var offset = i32( threadId * ${ BVH_STACK_DEPTH } );
			var pointer = 0;
			stack[ offset + pointer ] = 0u;

			var blasDidHit: bool = false;
			var objectIndex: u32 = 0;
			var localShape: ${ shapeStruct } = shape;

			// A single TLAS leaf can reference multiple object so these track which object within the
			// current leaf is being traversed.
			var tlasReset: i32 = 0;
			var leafOffset: u32 = 0u;
			var leafCount: u32 = 0u;
			var leafCursor: u32 = 0u;

			loop {

				// An object's BLAS has drained back to its TLAS leaf. Finalize the object that was
				// just traversed and advance to the next object in the leaf, or fall back to the TLAS.
				if ( ! isTLAS && tlasReset == pointer ) {

					if ( blasDidHit ) {

						blasDidHit = false;
						didHit = true;
						${ transformResultSnippet }

					}

					${ resetShapeSnippet }

					// March to the next visible object in the leaf, skipping invisible ones, and push
					// its BLAS root, or resume the TLAS once the leaf is complete.
					loop {

						if ( leafCursor >= leafCount ) {

							// resume the TLAS traversal
							objectIndex = 0;
							isTLAS = true;
							localShape = shape;
							break;

						}

						objectIndex = leafOffset + leafCursor;
						leafCursor = leafCursor + 1u;

						let transform = ${ transforms }[ objectIndex ];
						if ( transform.visible != 0u ) {

							pointer = pointer + 1;
							stack[ offset + pointer ] = transform.nodeOffset;

							// Transform shape into object local space
							localShape = shape;
							${ transformShapeSnippet }
							break;

						}

					}

				}

				// check if we've finished all nodes on the stack (or overrun the stack)
				if ( pointer < 0 || pointer >= i32( ${ BVH_STACK_DEPTH } ) ) {

					break;

				}

				let nodeIndex = stack[ offset + pointer ];
				let node = ${ nodes }[ nodeIndex ];
				pointer = pointer - 1;

				// skip the node if we don't intersect the bounds
				if ( ${ intersectsBoundsFn }( localShape, node.bounds, ${ resultArg } ) == 0u ) {

					continue;

				}

				let infoX = node.splitAxisOrTriangleCount;
				let infoY = node.rightChildOrTriangleOffset;
				let isLeaf = ( infoX & 0xffff0000u ) != 0u;

				if ( isLeaf ) {

					let count = infoX & 0x0000ffffu;
					let offset = infoY;

					if ( isTLAS ) {

						// Record the leaf's object range which we will march through over the
						// following iterations.
						leafOffset = offset;
						leafCount = count;
						leafCursor = 0u;
						tlasReset = pointer;
						isTLAS = false;
						blasDidHit = false;

					} else {

						blasDidHit = ${ intersectRangeFn }( localShape, offset, count, ${ resultArg } ) || blasDidHit;

					}

				} else {

					let leftIndex = nodeIndex + 1u;
					let splitAxis = infoX & 0x0000ffffu;
					let rightIndex = nodeIndex + infoY;

					var c1 = rightIndex;
					var c2 = leftIndex;
					${ leftToRightSnippet }

					pointer = pointer + 1;
					stack[ offset + pointer ] = c2;

					pointer = pointer + 1;
					stack[ offset + pointer ] = c1;

				}

			}

			return didHit;

		}
	`;

	tlasFn.outputType = resultStruct;
	tlasFn.functionName = name;

	return tlasFn;

}
