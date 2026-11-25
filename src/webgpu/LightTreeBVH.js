import { BVH, CENTER } from 'three-mesh-bvh';

// The words of three-mesh-bvh's packed node: its bounds' min and max, then the right child's offset from the node or a
// leaf's primitive offset, then two 16 bit halves, the last of them the flag that marks a leaf
const BVH_NODE_WORDS = 8;
const BVH_LINK_WORD = 6;
const BVH_LEAF_HALF_WORD = 15;
const BVH_LEAF_FLAG = 0xffff;

// The floats of a light tree node:
// - its bounds' min and its power
// - its bounds' max and its second child's node index, or -( triangle index + 1 ) for a leaf
// The first child follows its node. Indices are stored as floats, exact up to 2^24
const NODE_FLOATS = 8;

// A light tree over triangles given by their bounds, built by three-mesh-bvh with one triangle per leaf
// TODO: packing and walking the tree with BVHComputeData instead of this class needs per-node data (three-mesh-bvh#988)
export class LightTreeBVH extends BVH {

	constructor( triangleBounds ) {

		super();

		// the build reorders the triangle indices in the primitive buffer into leaf order
		this.triangleBounds = triangleBounds;
		this.primitiveBuffer = new Uint32Array( triangleBounds.length / 6 ).map( ( value, i ) => i );
		this.primitiveBufferStride = 1;
		this.init( {
			// TODO: a split that accounts for the triangles' power may build a better tree. A power weighted SAH
			// was tried and was no better than CENTER over the Zero-Day and Bistro scenes
			strategy: CENTER,
			targetLeafSize: 1,
			_strictLeafSize: 1,
			maxDepth: Infinity,
			verbose: false,
		} );

	}

	getRootRanges() {

		return [ { offset: 0, count: this.primitiveBuffer.length } ];

	}

	writePrimitiveBounds( triangle, target, offset ) {

		for ( let i = 0; i < 6; i ++ ) {

			target[ offset + i ] = this.triangleBounds[ triangle * 6 + i ];

		}

	}

	// Returns the nodes as floats with the power of the triangles under them, and the node of each triangle's leaf
	getNodes( trianglePowers ) {

		const root = this._roots[ 0 ];
		const bvhFloats = new Float32Array( root );
		const bvhUints = new Uint32Array( root );
		const bvhHalves = new Uint16Array( root );

		const nodeCount = bvhFloats.length / BVH_NODE_WORDS;
		const nodes = new Float32Array( nodeCount * NODE_FLOATS );
		const triangleLeaves = new Uint32Array( trianglePowers.length );

		// children follow their parent, so going backward sums each node's power from its children
		for ( let node = nodeCount - 1; node >= 0; node -- ) {

			const source = node * BVH_NODE_WORDS;
			const target = node * NODE_FLOATS;
			const link = bvhUints[ source + BVH_LINK_WORD ];
			const isLeaf = bvhHalves[ source * 2 + BVH_LEAF_HALF_WORD ] === BVH_LEAF_FLAG;

			for ( let axis = 0; axis < 3; axis ++ ) {

				nodes[ target + axis ] = bvhFloats[ source + axis ];
				nodes[ target + 4 + axis ] = bvhFloats[ source + 3 + axis ];

			}

			if ( isLeaf ) {

				const triangle = this.primitiveBuffer[ link ];
				nodes[ target + 3 ] = trianglePowers[ triangle ];
				nodes[ target + 7 ] = - ( triangle + 1 );
				triangleLeaves[ triangle ] = node;

			} else {

				const firstChild = node + 1;
				const secondChild = node + link;
				nodes[ target + 3 ] = nodes[ firstChild * NODE_FLOATS + 3 ] + nodes[ secondChild * NODE_FLOATS + 3 ];
				nodes[ target + 7 ] = secondChild;

			}

		}

		return { nodes, triangleLeaves };

	}

}
