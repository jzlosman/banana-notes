import {
  pinTag, unpinTag, movePinnedTag, type ScopePreferences,
} from '../domain/scope-preferences';
import {
  pruneScopeBookmarks, selectNotebooks, selectedTags, updateScopeBookmark, type Library,
} from '../domain/library';

/** Application use cases for notebook scopes and their user-owned navigation preferences. */
export class ScopeCommands {
  pin(preferences: ScopePreferences, tag: string): ScopePreferences {
    return { ...preferences, pinnedTags: pinTag(preferences.pinnedTags, tag) };
  }
  unpin(preferences: ScopePreferences, tag: string): ScopePreferences {
    return { ...preferences, pinnedTags: unpinTag(preferences.pinnedTags, tag) };
  }
  move(preferences: ScopePreferences, tag: string, delta: number): ScopePreferences {
    return { ...preferences, pinnedTags: movePinnedTag(preferences.pinnedTags, tag, delta) };
  }
  select(library: Library, tags: string[], preferences: ScopePreferences): { library: Library; preferences: ScopePreferences } {
    const bookmarks = updateScopeBookmark(preferences.bookmarks, selectedTags(library), library.selectedID);
    const nextLibrary = selectNotebooks(library, tags, bookmarks);
    const nextBookmarks = updateScopeBookmark(bookmarks, tags, nextLibrary.selectedID);
    return {
      library: nextLibrary,
      preferences: { ...preferences, bookmarks: pruneScopeBookmarks(nextBookmarks, nextLibrary) },
    };
  }
  rememberSelection(previous: Library, next: Library, preferences: ScopePreferences): ScopePreferences {
    let bookmarks = updateScopeBookmark(preferences.bookmarks, selectedTags(previous), previous.selectedID);
    bookmarks = updateScopeBookmark(bookmarks, selectedTags(next), next.selectedID);
    return { ...preferences, bookmarks: pruneScopeBookmarks(bookmarks, next) };
  }
}
