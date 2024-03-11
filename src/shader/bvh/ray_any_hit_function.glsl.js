export const ray_any_hit_function = /* glsl */`

	bool bvhIntersectAnyHit(
		vec3 rayOrigin, vec3 rayDirection,

		// output variables
		inout float side, inout float dist
	) {

		uvec4 faceIndices;
		vec3 faceNormal;
		vec3 barycoord;

		// stack needs to be twice as long as the deepest tree we expect because
		// we push both the left and right child onto the stack every traversal
		int ptr = 0;
		uint stack[ 60 ];
		stack[ 0 ] = 0u;

		float triangleDistance = 1e20;
		while ( ptr > - 1 && ptr < 60 ) {

			uint currNodeIndex = stack[ ptr ];
			ptr --;

			// check if we intersect the current bounds
			float boundsHitDistance = intersectsBVHNodeBounds( rayOrigin, rayDirection, bvh, currNodeIndex );
			if ( boundsHitDistance == INFINITY ) {

				continue;

			}

			uvec2 boundsInfo = uTexelFetch1D( bvh.bvhContents, currNodeIndex ).xy;
			bool isLeaf = bool( boundsInfo.x & 0xffff0000u );

			if ( isLeaf ) {

				uint count = boundsInfo.x & 0x0000ffffu;
				uint offset = boundsInfo.y;

				bool found = intersectTriangles(
					bvh, rayOrigin, rayDirection, offset, count, triangleDistance,
					faceIndices, faceNormal, barycoord, side, dist
				);

				if ( found ) {

					return true;

				}

			} else {

				uint leftIndex = currNodeIndex + 1u;
				uint splitAxis = boundsInfo.x & 0x0000ffffu;
				uint rightIndex = boundsInfo.y;

				// set c2 in the stack so we traverse it later. We need to keep track of a pointer in
				// the stack while we traverse. The second pointer added is the one that will be
				// traversed first
				ptr ++;
				stack[ ptr ] = leftIndex;

				ptr ++;
				stack[ ptr ] = rightIndex;

			}

		}

		return false;

	}

`;
