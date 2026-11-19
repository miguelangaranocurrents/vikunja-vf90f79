import {Extension} from '@tiptap/core'
import {Plugin, PluginKey} from '@tiptap/pm/state'
import type {Fragment, Node as ProseMirrorNode, Slice} from '@tiptap/pm/model'

function leafText(node: ProseMirrorNode): string {
	if (node.type.name === 'hardBreak') {
		return '\n'
	}
	const spec = node.type.spec as {leafText?: (node: ProseMirrorNode) => string}
	if (typeof spec.leafText === 'function') {
		return spec.leafText(node)
	}
	return node.textContent ?? ''
}

function inlineText(node: ProseMirrorNode): string {
	return node.textBetween(0, node.content.size, '\n', leafText)
}

function prefixLines(text: string, first: string, rest: string): string {
	return text
		.split('\n')
		.map((line, i) => (i === 0 ? first : rest) + line)
		.join('\n')
}

function serializeListItem(item: ProseMirrorNode, marker: string): string {
	const body = serializeBlocks(item.content, '\n')
	return prefixLines(body, marker, ' '.repeat(marker.length))
}

function serializeBlock(node: ProseMirrorNode): string {
	switch (node.type.name) {
		case 'bulletList': {
			const items: string[] = []
			node.forEach(item => items.push(serializeListItem(item, '- ')))
			return items.join('\n')
		}
		case 'orderedList': {
			const start = Number(node.attrs.start ?? 1)
			const items: string[] = []
			node.forEach((item, _offset, index) => items.push(serializeListItem(item, `${start + index}. `)))
			return items.join('\n')
		}
		case 'taskList': {
			const items: string[] = []
			node.forEach(item => items.push(serializeListItem(item, item.attrs.checked ? '- [x] ' : '- [ ] ')))
			return items.join('\n')
		}
		case 'blockquote':
			return prefixLines(serializeBlocks(node.content, '\n\n'), '> ', '> ')
		case 'codeBlock':
			return node.textContent
	}

	if (node.isTextblock) {
		return inlineText(node)
	}

	if (node.isLeaf) {
		return leafText(node)
	}

	return serializeBlocks(node.content, node.type.name === 'tableRow' ? '\t' : '\n')
}

function serializeBlocks(fragment: Fragment, separator: string): string {
	const parts: string[] = []
	fragment.forEach(child => {
		parts.push(child.isInline ? leafText(child) : serializeBlock(child))
	})
	// Inline content is joined without separators, blocks with the given one.
	if (fragment.firstChild?.isInline) {
		return parts.join('')
	}
	return parts.join(separator)
}

/**
 * Serializes a copied slice to plain text, keeping list markers so lists
 * survive pasting into plain text targets.
 */
export function serializeSliceAsText(slice: Slice): string {
	// A selection inside a single textblock should yield just its text, not the
	// markers of the list it happens to live in.
	let node: Fragment = slice.content
	while (node.childCount === 1 && !node.firstChild!.isInline) {
		const child = node.firstChild!
		if (child.isTextblock) {
			return inlineText(child)
		}
		node = child.content
	}

	if (slice.content.firstChild?.isInline) {
		return slice.content.textBetween(0, slice.content.size, '\n', leafText)
	}

	return serializeBlocks(slice.content, '\n\n')
}

export const ClipboardTextWithListMarkers = Extension.create({
	name: 'clipboardTextWithListMarkers',

	// Must run before tiptap's own clipboardTextSerializer, which would drop the markers.
	priority: 1000,

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey('clipboardTextWithListMarkers'),
				props: {
					clipboardTextSerializer: slice => serializeSliceAsText(slice),
				},
			}),
		]
	},
})
