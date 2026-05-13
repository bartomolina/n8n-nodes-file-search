const path = require('path');
const fs = require('fs');
const { task, src, dest } = require('gulp');

task('build:icons', copyIcons);

function copyIcons() {
	const nodeSource = path.resolve('nodes', '**', '*.{png,svg}');
	const nodeDestination = path.resolve('dist', 'nodes');

	const nodeIcons = src(nodeSource, { allowEmpty: true }).pipe(dest(nodeDestination));

	const credentialsDirectory = path.resolve('credentials');
	if (!fs.existsSync(credentialsDirectory)) {
		return nodeIcons;
	}

	const credSource = path.resolve(credentialsDirectory, '**', '*.{png,svg}');
	const credDestination = path.resolve('dist', 'credentials');

	return src(credSource, { allowEmpty: true }).pipe(dest(credDestination));
}
