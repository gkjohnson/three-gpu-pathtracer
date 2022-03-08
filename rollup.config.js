export default [
	{
		input: './src/index.js',
		treeshake: false,
		external: p => /^three/.test( p ),
		output: {

			name: 'ThreePathTracer',
			extend: true,
			format: 'umd',
			file: './build/index.umd.cjs',
			sourcemap: true,

			globals: p => {

				if ( /^three-mesh-bvh/.test( p ) ) {

					return 'MeshBVHLib';

				} else if ( /^three/.test( p ) ) {

					return 'THREE';

				}

				return null;

			},
		},
	},
	{
		input: './src/index.js',
		treeshake: false,
		external: p => /^three/.test( p ),
		output: {
			format: 'esm',
			file: './build/index.module.js',
			sourcemap: true,
		},
	}
];
