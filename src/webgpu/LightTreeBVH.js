import { BVH, CENTER } from 'three-mesh-bvh';

// three-mesh-bvh's packed node layout
const BVH_NODE_WORDS = 8;
const BVH_OFFSET_WORD = 6;
const BVH_LEAF_FLAG_HALF_WORD = 15;
const BVH_LEAF_FLAG = 0xffff;

// The packed light tree node layout, as two vec4s:
// - bounds min, power
// - bounds max, second child's node index or -( emissive triangle index + 1 ) for a leaf
// The first child is always the next node. Floats hold indices exactly up to 2^24
const NODE_FLOATS = 8;
const POWER_OFFSET = 3;
const BOUNDS_MAX_OFFSET = 4;
const CHILD_OR_TRIANGLE_OFFSET = 7;

// A BVH over triangles with one triangle per leaf, packed into a light tree
// TODO: use BVHComputeData instead once it supports per-node data (three-mesh-bvh#988)
export class LightTreeBVH extends BVH {

	constructor( triangleBounds, trianglePowers ) {

		super();

		this.triangleBounds = triangleBounds;
		this.trianglePowers = trianglePowers;

		// the emissive triangle indices, which the build sorts into leaf order
		this.primitiveBuffer = new Uint32Array( triangleBounds.length / 6 ).map( ( value, i ) => i );
		this.primitiveBufferStride = 1;
		this.init( {
			// TODO: try a split that accounts for power. A power weighted SAH was no better than CENTER on the Zero-Day
			// and Bistro scenes
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

	writePrimitiveBounds( emissiveTriangleIndex, target, offset ) {

		for ( let i = 0; i < 6; i ++ ) {

			target[ offset + i ] = this.triangleBounds[ emissiveTriangleIndex * 6 + i ];

		}

	}

	// Packs the nodes with the total power of their triangles. Returns the nodes and each triangle's leaf node index
	packNodesBuffer() {

		const { trianglePowers, primitiveBuffer } = this;
		const root = this._roots[ 0 ];
		const bvhFloat32 = new Float32Array( root );
		const bvhUint32 = new Uint32Array( root );
		const bvhUint16 = new Uint16Array( root );

		const nodeCount = bvhFloat32.length / BVH_NODE_WORDS;
		const nodesBuffer = new Float32Array( nodeCount * NODE_FLOATS );
		const leafNodeIndices = new Uint32Array( trianglePowers.length );

		// iterate backward so children are packed before their parent sums their power
		for ( let nodeIndex = nodeCount - 1; nodeIndex >= 0; nodeIndex -- ) {

			const bvhNodeOffset = nodeIndex * BVH_NODE_WORDS;
			const nodeOffset = nodeIndex * NODE_FLOATS;
			for ( let axis = 0; axis < 3; axis ++ ) {

				nodesBuffer[ nodeOffset + axis ] = bvhFloat32[ bvhNodeOffset + axis ];
				nodesBuffer[ nodeOffset + BOUNDS_MAX_OFFSET + axis ] = bvhFloat32[ bvhNodeOffset + 3 + axis ];

			}

			const isLeaf = bvhUint16[ bvhNodeOffset * 2 + BVH_LEAF_FLAG_HALF_WORD ] === BVH_LEAF_FLAG;
			if ( isLeaf ) {

				const primitiveOffset = bvhUint32[ bvhNodeOffset + BVH_OFFSET_WORD ];
				const emissiveTriangleIndex = primitiveBuffer[ primitiveOffset ];
				nodesBuffer[ nodeOffset + POWER_OFFSET ] = trianglePowers[ emissiveTriangleIndex ];
				nodesBuffer[ nodeOffset + CHILD_OR_TRIANGLE_OFFSET ] = - ( emissiveTriangleIndex + 1 );
				leafNodeIndices[ emissiveTriangleIndex ] = nodeIndex;

			} else {

				const firstChildIndex = nodeIndex + 1;
				const secondChildIndex = nodeIndex + bvhUint32[ bvhNodeOffset + BVH_OFFSET_WORD ];
				const firstPower = nodesBuffer[ firstChildIndex * NODE_FLOATS + POWER_OFFSET ];
				const secondPower = nodesBuffer[ secondChildIndex * NODE_FLOATS + POWER_OFFSET ];
				nodesBuffer[ nodeOffset + POWER_OFFSET ] = firstPower + secondPower;
				nodesBuffer[ nodeOffset + CHILD_OR_TRIANGLE_OFFSET ] = secondChildIndex;

			}

		}

		return { nodesBuffer, leafNodeIndices };

	}

}
