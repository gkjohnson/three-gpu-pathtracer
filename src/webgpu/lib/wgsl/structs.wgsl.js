import { StructTypeNode } from 'three/webgpu';

export const rayStruct = new StructTypeNode( {
	origin: 'vec3f',
	direction: 'vec3f',
}, 'Ray' );

export const bvhNodeBoundsStruct = new StructTypeNode( {
	min: 'array<f32, 3>',
	max: 'array<f32, 3>',
}, 'BVHBoundingBox' );
bvhNodeBoundsStruct.getLength = () => 6;

export const bvhNodeStruct = new StructTypeNode( {
	bounds: 'BVHBoundingBox',
	rightChildOrTriangleOffset: 'uint',
	splitAxisOrTriangleCount: 'uint',
}, 'BVHNode' );
bvhNodeStruct.getLength = () => bvhNodeBoundsStruct.getLength() + 2;

export const intersectionResultStruct = new StructTypeNode( {
	didHit: 'bool',
	indices: 'vec4u',
	normal: 'vec3f',
	barycoord: 'vec3f',
	side: 'float',
	dist: 'float',
}, 'IntersectionResult' );
