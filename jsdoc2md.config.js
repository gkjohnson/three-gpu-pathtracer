export default [
	{
		output: './src/webgpu/API.md',
		title: 'three-gpu-pathtracer/webgpu',
		source: './src/webgpu',

		// the materials are an internal extension point rather than part of the public surface
		exclude: './src/webgpu/materials',
	},
];
